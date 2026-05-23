// Intelligent VOD Agent — learns game profiles + provides second-opinion VOD analysis
// + SOLO MODE: independent storyboard + Vision pipeline (no reuse of pipeline data)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GQL_URL = "https://gql.twitch.tv/gql";
const GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

const AI_TIMEOUT_MS = 60_000;
const LEARN_ALL_BATCH_SIZE = 2;
const SOLO_MOSAICS_PER_CHUNK = 4; // baixa, pra não estourar o timeout
// Anti-alucinação: dois pisos. Acima de PROMOTION vira detecção; entre REVIEW e
// PROMOTION cai em fila silenciosa (não persistida) só para futura curadoria;
// abaixo de REVIEW descartamos por completo.
const SOLO_PROMOTION_THRESHOLD = 0.90;
const SOLO_REVIEW_THRESHOLD = 0.80;
const SOLO_MIN_CONFIDENCE = SOLO_PROMOTION_THRESHOLD;


const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ─── Learn a single game profile via Lovable AI ───────────────────────
async function learnGame(gameLibraryId: string) {
  const { data: game, error } = await sb
    .from("game_visual_library")
    .select("*")
    .eq("id", gameLibraryId)
    .single();
  if (error || !game) throw new Error("Game not found");

  const dna = game.visual_dna || {};
  const context = `
Jogo: ${game.game_name}
Provedor: ${game.provider_name}
Source URL: ${game.source_url || "—"}
Visual DNA existente: ${JSON.stringify(dna).slice(0, 2000)}
`.trim();

  const aiController = new AbortController();
  const aiTimeout = setTimeout(() => aiController.abort(), AI_TIMEOUT_MS);
  let aiResp: Response;
  try {
    aiResp = await fetch(AI_GATEWAY, {
      method: "POST",
      signal: aiController.signal,
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "Você é um especialista em identificação visual de jogos de cassino online. Extraia palavras-chave e marcadores visuais únicos." },
          { role: "user", content: `Analise os dados deste jogo:\n\n${context}\n\nGere agent_keywords (15-25 termos PT/EN curtos) e agent_visual_markers (8-15 marcadores visuais).` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "save_game_profile",
            parameters: {
              type: "object",
              properties: {
                agent_keywords: { type: "array", items: { type: "string" } },
                agent_visual_markers: { type: "array", items: { type: "string" } },
              },
              required: ["agent_keywords", "agent_visual_markers"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "save_game_profile" } },
      }),
    });
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") throw new Error("A IA demorou demais. Tente depois.");
    throw e;
  } finally {
    clearTimeout(aiTimeout);
  }

  if (!aiResp.ok) {
    const txt = await aiResp.text();
    if (aiResp.status === 429) throw new Error("Rate limit excedido.");
    if (aiResp.status === 402) throw new Error("Créditos do Lovable AI esgotados.");
    throw new Error(`AI error ${aiResp.status}: ${txt.slice(0, 200)}`);
  }

  const aiData = await aiResp.json();
  const toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("AI did not return a profile");
  const profile = JSON.parse(toolCall.function.arguments);

  await sb.from("game_visual_library").update({
    agent_keywords: profile.agent_keywords || [],
    agent_visual_markers: profile.agent_visual_markers || [],
    agent_learned_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", gameLibraryId);

  return { game_id: gameLibraryId, game_name: game.game_name };
}

async function learnAllPending(limit = LEARN_ALL_BATCH_SIZE) {
  const safeLimit = Math.max(0, Math.min(10, Math.floor(Number(limit) || 0)));
  const { data, error, count } = await sb
    .from("game_visual_library")
    .select("id, game_name", { count: "exact" })
    .eq("training_status", "trained")
    .is("agent_learned_at", null)
    .order("created_at", { ascending: true })
    .limit(safeLimit);
  if (error) throw error;

  const list = data || [];
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const g of list) {
    try {
      await learnGame(g.id);
      results.push({ id: g.id, ok: true });
      await new Promise((r) => setTimeout(r, 800));
    } catch (e: unknown) {
      results.push({ id: g.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return {
    total_pending: count || 0,
    processed: list.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    has_more: (count || 0) > list.length,
    remaining_estimate: Math.max(0, (count || 0) - list.length),
    results,
  };
}

// ─── Helpers (text matching reused) ───────────────────────────────────
function normalize(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ");
}
function tokenize(s: string): Set<string> {
  return new Set(normalize(s).split(/\s+/).filter((w) => w.length >= 2));
}
function keywordScore(haystack: Set<string>, kws: string[]): number {
  if (!kws?.length) return 0;
  let hits = 0;
  for (const kw of kws) {
    const tokens = normalize(kw).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    if (tokens.every((t) => haystack.has(t))) hits++;
  }
  return Math.min(1, hits / Math.max(1, Math.min(kws.length, 10)));
}
function visualScore(haystack: Set<string>, markers: string[]): number {
  if (!markers?.length) return 0;
  let hits = 0;
  for (const m of markers) {
    const tokens = normalize(m).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    if (tokens.some((t) => haystack.has(t))) hits++;
  }
  return Math.min(1, hits / Math.max(1, Math.min(markers.length, 6)));
}

// ─── Original analyze (reuses raw_evidences) ─────────────────────────
async function analyzeVod(vodId: string) {
  const { data: games, error: gErr } = await sb
    .from("game_visual_library")
    .select("id, game_name, provider_name, agent_keywords, agent_visual_markers, agent_confidence_threshold")
    .not("agent_learned_at", "is", null);
  if (gErr) throw gErr;
  const profiles = (games || []).filter((g) => (g.agent_keywords?.length || 0) + (g.agent_visual_markers?.length || 0) > 0);
  if (profiles.length === 0) return { vod_id: vodId, blocks: 0, message: "Nenhum perfil aprendido." };

  const { data: evidences } = await sb
    .from("raw_evidences")
    .select("id, timestamp_seconds, game_detected, provider_detected, extra_metadata, screen_state, casino_brand")
    .eq("vod_id", vodId)
    .order("timestamp_seconds", { ascending: true });
  if (!evidences || evidences.length === 0) return { vod_id: vodId, blocks: 0, message: "Sem evidências." };

  const { data: audit } = await sb.from("vod_audits").select("streamer_login").eq("vod_id", vodId).maybeSingle();
  const streamerLogin = audit?.streamer_login || "unknown";

  const { data: pipelineBlocks } = await sb.from("gameplay_blocks").select("game_name, start_seconds, end_seconds").eq("vod_id", vodId);

  type Detection = { ts: number; game: typeof profiles[0]; conf: number; kc: number; vc: number };
  const detections: Detection[] = [];
  for (const ev of evidences) {
    const meta = (ev.extra_metadata as Record<string, unknown>) || {};
    const textParts = [ev.game_detected, ev.provider_detected, ev.casino_brand, ev.screen_state, typeof meta.ocr === "string" ? meta.ocr : "", typeof meta.evidence === "string" ? meta.evidence : ""].filter(Boolean).join(" ");
    const visualParts = [typeof meta.color_palette === "string" ? meta.color_palette : "", Array.isArray(meta.visual_markers) ? meta.visual_markers.join(" ") : "", ev.screen_state || ""].join(" ");
    const textTokens = tokenize(textParts + " " + visualParts);
    const visualTokens = tokenize(visualParts);
    let best: Detection | null = null;
    for (const p of profiles) {
      const kc = keywordScore(textTokens, p.agent_keywords || []);
      const vc = visualScore(visualTokens, p.agent_visual_markers || []);
      const conf = kc * 0.6 + vc * 0.4;
      const threshold = Number(p.agent_confidence_threshold) || 0.7;
      if (conf >= threshold && (!best || conf > best.conf)) {
        best = { ts: ev.timestamp_seconds || 0, game: p, conf, kc, vc };
      }
    }
    if (best) detections.push(best);
  }
  return await persistDetectionBlocks(vodId, streamerLogin, detections, pipelineBlocks || []);
}

// ─── SOLO MODE: storyboards + Vision ─────────────────────────────────
async function fetchStoryboardPlan(vodId: string) {
  const r1 = await fetch(GQL_URL, {
    method: "POST",
    headers: { "Client-ID": GQL_CLIENT_ID, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `query{video(id:"${vodId}"){seekPreviewsURL}}` }),
  });
  if (!r1.ok) return null;
  const gql = await r1.json();
  const infoUrl: string | undefined = gql?.data?.video?.seekPreviewsURL;
  if (!infoUrl) return null;
  const r2 = await fetch(infoUrl);
  if (!r2.ok) return null;
  const variants: any[] = await r2.json();
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const byQ = (q: string) => variants.find((v: any) => String(v.quality).toLowerCase() === q);
  const variant = byQ("high") ?? byQ("medium") ?? variants[variants.length - 1];
  const quality = String(variant?.quality ?? "unknown").toLowerCase();
  const { count, cols, rows, width, height, interval, images } = variant;
  if (!count || !cols || !rows || !interval || !Array.isArray(images)) return null;
  const baseUrl = infoUrl.substring(0, infoUrl.lastIndexOf("/") + 1);
  const tilesPerImage = cols * rows;
  const mosaics = images.map((imgName: string, mosaicIdx: number) => {
    const tiles: Array<{ row: number; col: number; ts: number }> = [];
    const startGlobal = mosaicIdx * tilesPerImage;
    const endGlobal = Math.min(startGlobal + tilesPerImage, count);
    for (let g = startGlobal; g < endGlobal; g++) {
      const localIdx = g - startGlobal;
      tiles.push({ row: Math.floor(localIdx / cols), col: localIdx % cols, ts: Math.round(g * interval + interval / 2) });
    }
    return { url: baseUrl + imgName, cols, rows, tile_w: width, tile_h: height, tiles };
  });
  return { mosaics, interval, total_tiles: count, quality };
}

async function fetchAsBase64(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`storyboard fetch ${r.status}`);
  const ab = await r.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function buildSoloPrompt(profiles: Array<{ game_name: string; provider_name: string | null; agent_keywords: string[]; agent_visual_markers: string[] }>) {
  const lib = profiles.slice(0, 120).map((p) => {
    const traits = [
      ...(p.agent_visual_markers || []).slice(0, 6),
      ...(p.agent_keywords || []).slice(0, 4),
    ].filter(Boolean).join(", ");
    return `${p.game_name} | ${p.provider_name || "—"} | ${traits}`;
  }).join("\n");
  return `Você é um identificador visual de jogos de cassino online olhando UM STORYBOARD da Twitch (grid linha-por-linha, esquerda→direita, cima→baixo). Para CADA tile, decida qual jogo está sendo exibido naquele instante específico — ou diga que NÃO SABE.

REGRA MAIS IMPORTANTE:
"unknown" (game_name = null) é a resposta correta na MAIORIA dos casos. Se você não tem certeza visual ALTA de que o tile corresponde a um jogo da lista abaixo, devolva game_name = null. Não invente. Não escolha o "mais próximo". Não tente ser útil chutando. Errar com confiança alta é PIOR do que dizer null.

LISTA FECHADA DE JOGOS CONHECIDOS (formato: Nome | Provedora | traços visuais distintivos):
${lib}

Você só pode preencher game_name com um dos nomes EXATOS da lista acima — caractere a caractere — OU null. Qualquer outro valor é tratado como alucinação e descartado.

PARA CADA TILE, decida primeiro:
- screen_state: "gameplay" (jogando: rolos, botão spin, mesa, valores R$), "loading" (logo grande do jogo carregando), "lobby" (lista de vários jogos), "other" (não-cassino, webcam, Just Chatting, BRB, etc.)

CRITÉRIOS PARA PREENCHER game_name (TODOS precisam ser verdadeiros):
1. Você consegue identificar visualmente pelo menos DOIS elementos distintivos descritos para aquele jogo na lista (HUD, símbolos únicos, paleta, logo, layout dos reels).
2. Esses elementos NÃO são genéricos — símbolos comuns a vários slots (cerejas, 7s, BARs, diamantes) NÃO contam como distintivo.
3. Você consegue descrever em UMA frase por que é esse jogo e não outro parecido.
Se qualquer um dos três falhar: game_name = null.

CASOS EM QUE game_name É SEMPRE null:
- screen_state = "lobby" ou "other" (sempre null, sem exceção).
- HUD coberto por webcam/overlay e você só vê pedaços genéricos.
- Slot parece com algo da lista mas você não tem certeza alta.
- Jogo de cassino que NÃO está na lista (mesmo que você "saiba" o nome por outro contexto).
- Tile borrado, escuro, em transição ou com artefatos pesados.

ANTI-PADRÕES (NÃO faça):
- NÃO escolha um jogo só porque tem reels girando — reels existem em centenas de slots.
- NÃO escolha por tema (frutas, pedras, animais) — temas são genéricos.
- NÃO escolha porque o nome parece familiar. Sua familiaridade não é evidência visual.
- NÃO escolha o "mais próximo" da lista quando nada bate. Ou bate, ou é null.
- Markers visuais textuais ("header amarelo", "fundo azul") só servem para CONFIRMAR um jogo já candidato, NUNCA para deduzir um nome do zero.

CALIBRAÇÃO DE confidence:
- 0.95–1.00: 3+ elementos distintivos únicos batem. Sem ambiguidade.
- 0.90–0.94: 2 elementos distintivos. Pequena ambiguidade.
- 0.80–0.89: 1 elemento ou parcialmente coberto. Nesse intervalo, PREFIRA null salvo evidência muito forte.
- < 0.80: SEMPRE null.

É MUITO MELHOR retornar null do que errar. Um falso positivo prejudica o relatório do cliente; um null apenas omite. Você NÃO ajuda o sistema chutando — você ajuda sendo CONSERVADOR.`;
}

async function callVisionOnMosaic(prompt: string, base64: string, gridCols: number, gridRows: number, tileCount: number) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), AI_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(AI_GATEWAY, {
      method: "POST",
      signal: ctl.signal,
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "Você analisa storyboards de VOD da Twitch para detectar jogos de cassino. Conservador por padrão — prefira null a errar. Sempre use a tool save_tiles." },
          { role: "user", content: [
            { type: "text", text: `${prompt}\n\nGRID_COLS=${gridCols} GRID_ROWS=${gridRows} TILE_COUNT=${tileCount}` },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
          ]},
        ],
        tools: [{
          type: "function",
          function: {
            name: "save_tiles",
            parameters: {
              type: "object",
              properties: {
                tiles: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      row: { type: "number" },
                      col: { type: "number" },
                      screen_state: { type: "string", enum: ["gameplay", "loading", "lobby", "other"] },
                      game_name: { type: ["string", "null"] },
                      confidence: { type: "number" },
                      visual_evidence: { type: "string" },
                      distinctive_elements_matched: { type: "array", items: { type: "string" } },
                    },
                    required: ["row", "col", "screen_state", "game_name", "confidence"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["tiles"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "save_tiles" } },
      }),
    });
  } finally { clearTimeout(t); }
  if (!resp.ok) {
    const txt = await resp.text();
    if (resp.status === 429) throw new Error("Rate limit");
    if (resp.status === 402) throw new Error("Créditos esgotados");
    throw new Error(`Vision ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  const tc = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc) return { tiles: [] };
  return JSON.parse(tc.function.arguments) as { tiles: Array<{ row: number; col: number; screen_state: string; game_name: string | null; confidence: number; visual_evidence?: string; distinctive_elements_matched?: string[] }> };
}


async function persistDetectionBlocks(
  vodId: string,
  streamerLogin: string,
  detections: Array<{ ts: number; game: { id: string; game_name: string; provider_name: string | null }; conf: number; kc: number; vc: number }>,
  pipelineBlocks: Array<{ game_name: string | null; start_seconds: number; end_seconds: number }>,
) {
  const GAP = 90;
  detections.sort((a, b) => a.ts - b.ts);
  const blocks: Array<{ game_id: string; game_name: string; provider_name: string; start: number; end: number; confSum: number; kcSum: number; vcSum: number; n: number }> = [];
  for (const d of detections) {
    const last = blocks[blocks.length - 1];
    if (last && last.game_id === d.game.id && d.ts - last.end <= GAP) {
      last.end = d.ts; last.confSum += d.conf; last.kcSum += d.kc; last.vcSum += d.vc; last.n++;
    } else {
      blocks.push({ game_id: d.game.id, game_name: d.game.game_name, provider_name: d.game.provider_name || "", start: d.ts, end: d.ts, confSum: d.conf, kcSum: d.kc, vcSum: d.vc, n: 1 });
    }
  }
  await sb.from("agent_analyses").delete().eq("vod_id", vodId);
  const rows = blocks.filter((b) => b.end - b.start >= 30 || b.n >= 2).map((b) => {
    const agrees = pipelineBlocks.some((pb) => pb.game_name?.toLowerCase() === b.game_name.toLowerCase() && pb.start_seconds <= b.end && pb.end_seconds >= b.start);
    return {
      vod_id: vodId, streamer_login: streamerLogin, game_library_id: b.game_id,
      game_name: b.game_name, provider_name: b.provider_name,
      start_seconds: b.start, end_seconds: b.end, duration_seconds: Math.max(b.end - b.start, 30),
      confidence: Number((b.confSum / b.n).toFixed(3)),
      keyword_confidence: Number((b.kcSum / b.n).toFixed(3)),
      visual_confidence: Number((b.vcSum / b.n).toFixed(3)),
      agrees_with_pipeline: pipelineBlocks.length ? agrees : null,
    };
  });
  if (rows.length > 0) await sb.from("agent_analyses").insert(rows);
  return { vod_id: vodId, blocks: rows.length, detections: detections.length };
}

async function soloStart(vodId: string, streamerLogin: string) {
  const plan = await fetchStoryboardPlan(vodId);
  if (!plan) throw new Error("Twitch não expôs storyboards para esse VOD.");
  const { data: profiles } = await sb
    .from("game_visual_library")
    .select("id, game_name, provider_name, agent_keywords, agent_visual_markers")
    .not("agent_learned_at", "is", null);
  if (!profiles || profiles.length === 0) throw new Error("Nenhum jogo aprendido pelo agente. Treine primeiro.");

  // limpa run anterior + analyses anteriores deste VOD
  await sb.from("agent_runs").delete().eq("vod_id", vodId);
  await sb.from("agent_analyses").delete().eq("vod_id", vodId);

  const { data: run, error } = await sb.from("agent_runs").insert({
    vod_id: vodId,
    streamer_login: streamerLogin,
    status: "running",
    cursor_mosaic: 0,
    total_mosaics: plan.mosaics.length,
    total_tiles: plan.total_tiles,
    plan: { mosaics: plan.mosaics, interval: plan.interval, profile_count: profiles.length, quality: plan.quality },
    started_at: new Date().toISOString(),
    message: `Plano (${plan.quality}): ${plan.mosaics.length} mosaicos / ${plan.total_tiles} frames.`,
  }).select("id").single();
  if (error) throw error;

  selfInvoke({ action: "solo_resume", run_id: run.id });
  return { run_id: run.id, total_mosaics: plan.mosaics.length, total_tiles: plan.total_tiles };
}

function selfInvoke(body: Record<string, unknown>) {
  fetch(`${SUPABASE_URL}/functions/v1/intelligent-vod-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify(body),
  }).catch((e) => console.warn("self-invoke failed:", e));
}

async function soloResume(runId: string) {
  const { data: run, error } = await sb.from("agent_runs").select("*").eq("id", runId).single();
  if (error || !run) throw new Error("Run não encontrado");
  if (run.status === "completed" || run.status === "failed") return { ok: true, status: run.status };

  const plan = run.plan as { mosaics: any[]; interval: number; profile_count: number };
  const mosaics = plan?.mosaics || [];
  const cursor = run.cursor_mosaic || 0;
  if (cursor >= mosaics.length) {
    await finalizeSolo(runId, run.vod_id, run.streamer_login);
    return { ok: true, status: "completed" };
  }

  const { data: profiles } = await sb
    .from("game_visual_library")
    .select("id, game_name, provider_name, agent_keywords, agent_visual_markers, agent_confidence_threshold")
    .not("agent_learned_at", "is", null);
  const profilesArr = profiles || [];
  const profileById = new Map(profilesArr.map((p) => [p.game_name.toLowerCase(), p]));
  const prompt = buildSoloPrompt(profilesArr);

  const end = Math.min(cursor + SOLO_MOSAICS_PER_CHUNK, mosaics.length);
  const detRows: Array<{ vod_id: string; streamer_login: string; game_library_id: string; game_name: string; provider_name: string | null; start_seconds: number; end_seconds: number; duration_seconds: number; confidence: number; keyword_confidence: number; visual_confidence: number; agrees_with_pipeline: boolean | null }> = [];
  let processedTiles = 0;

  for (let i = cursor; i < end; i++) {
    const m = mosaics[i];
    try {
      const b64 = await fetchAsBase64(m.url);
      const out = await callVisionOnMosaic(prompt, b64, m.cols, m.rows, m.tiles.length);
      const tilesByKey = new Map<string, { ts: number }>();
      for (const t of m.tiles) tilesByKey.set(`${t.row}-${t.col}`, { ts: t.ts });
      let hallucinated = 0, reviewSkipped = 0, lowConf = 0, nonGameplay = 0;
      for (const tile of out.tiles || []) {
        const key = `${tile.row}-${tile.col}`;
        const ref = tilesByKey.get(key);
        if (!ref) continue;
        // Lobby/other nunca produzem game_name — descarte defensivo
        if (tile.screen_state === "lobby" || tile.screen_state === "other") {
          if (tile.game_name) nonGameplay++;
          continue;
        }
        if (!tile.game_name) continue;
        // Validação de lista fechada — modelo só pode citar nomes EXATOS da biblioteca
        const profile = profileById.get(tile.game_name.toLowerCase());
        if (!profile) {
          hallucinated++;
          console.warn(`solo: hallucinated game_name "${tile.game_name}" (não está na biblioteca)`);
          continue;
        }
        const tileConf = tile.confidence ?? 0;
        const perGameThreshold = Number((profile as any).agent_confidence_threshold);
        const baseThreshold = Number.isFinite(perGameThreshold) && perGameThreshold > 0 ? perGameThreshold : SOLO_PROMOTION_THRESHOLD;
        const promoteAt = Math.max(baseThreshold, SOLO_PROMOTION_THRESHOLD);
        if (tileConf < SOLO_REVIEW_THRESHOLD) { lowConf++; continue; }
        if (tileConf < promoteAt) { reviewSkipped++; continue; } // zona cinzenta — não promove
        detRows.push({
          vod_id: run.vod_id,
          streamer_login: run.streamer_login,
          game_library_id: profile.id,
          game_name: profile.game_name,
          provider_name: profile.provider_name,
          start_seconds: ref.ts,
          end_seconds: ref.ts,
          duration_seconds: 30,
          confidence: tile.confidence,
          keyword_confidence: 0,
          visual_confidence: tile.confidence,
          agrees_with_pipeline: null,
        });
      }
      if (hallucinated || reviewSkipped || lowConf || nonGameplay) {
        console.log(`solo mosaic ${i}: hallucinated=${hallucinated} review=${reviewSkipped} low=${lowConf} nonGameplay=${nonGameplay}`);
      }

      processedTiles += m.tiles.length;
    } catch (e) {
      console.warn(`solo mosaic ${i} failed:`, e);
    }
  }

  // Insere detecções pontuais (sem dedup de bloco ainda — finalize agrupa).
  // Sort by timestamp so finalizeSolo grouping produces correct continuous blocks.
  if (detRows.length > 0) {
    detRows.sort((a, b) => a.start_seconds - b.start_seconds);
    await sb.from("agent_analyses").insert(detRows);
  }

  const newCursor = end;
  await sb.from("agent_runs").update({
    cursor_mosaic: newCursor,
    processed_tiles: (run.processed_tiles || 0) + processedTiles,
    detections_count: (run.detections_count || 0) + detRows.length,
    message: `Mosaico ${newCursor}/${mosaics.length} · ${(run.detections_count || 0) + detRows.length} detecções até agora.`,
    updated_at: new Date().toISOString(),
  }).eq("id", runId);

  if (newCursor < mosaics.length) {
    selfInvoke({ action: "solo_resume", run_id: runId });
    return { ok: true, status: "running", cursor: newCursor };
  } else {
    await finalizeSolo(runId, run.vod_id, run.streamer_login);
    return { ok: true, status: "completed" };
  }
}

async function finalizeSolo(runId: string, vodId: string, streamerLogin: string) {
  // Agrupa as detecções pontuais inseridas em blocos contínuos por jogo
  const { data: raw } = await sb
    .from("agent_analyses")
    .select("id, game_library_id, game_name, provider_name, start_seconds, confidence")
    .eq("vod_id", vodId)
    .order("start_seconds", { ascending: true });
  if (raw && raw.length > 0) {
    type R = { id: string; game_library_id: string | null; game_name: string; provider_name: string | null; start_seconds: number; confidence: number };
    const arr = raw as R[];
    const GAP = 120;
    const groups: Array<{ game_library_id: string; game_name: string; provider_name: string | null; start: number; end: number; sum: number; n: number; ids: string[] }> = [];
    for (const d of arr) {
      if (!d.game_library_id) continue;
      const last = groups[groups.length - 1];
      if (last && last.game_library_id === d.game_library_id && d.start_seconds - last.end <= GAP) {
        last.end = d.start_seconds; last.sum += d.confidence; last.n++; last.ids.push(d.id);
      } else {
        groups.push({ game_library_id: d.game_library_id, game_name: d.game_name, provider_name: d.provider_name, start: d.start_seconds, end: d.start_seconds, sum: d.confidence, n: 1, ids: [d.id] });
      }
    }
    const { data: pipelineBlocks } = await sb.from("gameplay_blocks").select("game_name, start_seconds, end_seconds").eq("vod_id", vodId);
    await sb.from("agent_analyses").delete().eq("vod_id", vodId);
    const rows = groups.filter((g) => g.end - g.start >= 30 || g.n >= 2).map((g) => {
      const agrees = (pipelineBlocks || []).some((pb) => pb.game_name?.toLowerCase() === g.game_name.toLowerCase() && pb.start_seconds <= g.end && pb.end_seconds >= g.start);
      return {
        vod_id: vodId, streamer_login: streamerLogin, game_library_id: g.game_library_id,
        game_name: g.game_name, provider_name: g.provider_name,
        start_seconds: g.start, end_seconds: g.end, duration_seconds: Math.max(g.end - g.start, 30),
        confidence: Number((g.sum / g.n).toFixed(3)),
        keyword_confidence: 0, visual_confidence: Number((g.sum / g.n).toFixed(3)),
        agrees_with_pipeline: (pipelineBlocks && pipelineBlocks.length) ? agrees : null,
      };
    });
    if (rows.length > 0) await sb.from("agent_analyses").insert(rows);
  }
  await sb.from("agent_runs").update({
    status: "completed",
    completed_at: new Date().toISOString(),
    message: "Análise solo concluída.",
    updated_at: new Date().toISOString(),
  }).eq("id", runId);
}

// ─── Feedback / dashboard ────────────────────────────────────────────
async function submitFeedback(p: { analysis_id: string; corrected_game_id?: string | null; correction_type: string; notes?: string; user_id?: string }) {
  const { data: an, error } = await sb.from("agent_analyses").select("game_library_id").eq("id", p.analysis_id).single();
  if (error || !an) throw new Error("Analysis not found");
  await sb.from("agent_feedback").insert({
    analysis_id: p.analysis_id,
    original_game_id: an.game_library_id,
    corrected_game_id: p.corrected_game_id || null,
    correction_type: p.correction_type,
    notes: p.notes || null,
    created_by: p.user_id || null,
  });
  return { ok: true };
}

async function getDashboard() {
  const [{ count: total }, { count: corrections }, { count: confirmed }] = await Promise.all([
    sb.from("agent_analyses").select("*", { count: "exact", head: true }),
    sb.from("agent_analyses").select("*", { count: "exact", head: true }).eq("user_corrected", true),
    sb.from("agent_analyses").select("*", { count: "exact", head: true }).eq("user_confirmed", true),
  ]);
  const { data: learnedGames } = await sb
    .from("game_visual_library")
    .select("id, game_name, provider_name, agent_times_identified, agent_times_corrected, agent_average_confidence, agent_confidence_threshold, agent_learned_at")
    .not("agent_learned_at", "is", null);
  const totalNum = total || 0;
  const games = learnedGames || [];
  return {
    metrics: {
      total_analyses: totalNum,
      total_corrections: corrections || 0,
      total_confirmed: confirmed || 0,
      accuracy: totalNum > 0 ? (totalNum - (corrections || 0)) / totalNum : 0,
      learned_games: games.length,
    },
    top_games: [...games].filter((g) => (g.agent_times_identified || 0) > 0).sort((a, b) => Number(b.agent_average_confidence) - Number(a.agent_average_confidence)).slice(0, 10),
    needs_retraining: [...games].filter((g) => (g.agent_times_corrected || 0) > 0).sort((a, b) => (b.agent_times_corrected || 0) - (a.agent_times_corrected || 0)).slice(0, 10),
  };
}

// ─── HTTP handler ────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const action = body.action as string;
    switch (action) {
      case "learn_game":
        return json(await learnGame(body.game_library_id));
      case "learn_all_pending": {
        const result = await learnAllPending(body.limit);
        return json({ ...result, message: result.has_more ? `Lote processado. Restam ~${result.remaining_estimate}.` : "Aprendizado concluído." });
      }
      case "analyze_vod":
        return json(await analyzeVod(body.vod_id));
      case "get_vod_analyses": {
        const { data, error } = await sb.from("agent_analyses").select("*").eq("vod_id", body.vod_id).order("start_seconds", { ascending: true });
        if (error) throw error;
        return json({ analyses: data || [] });
      }
      case "solo_start": {
        if (!body.vod_id || !body.streamer_login) return json({ error: "vod_id e streamer_login obrigatórios" }, 400);
        return json(await soloStart(body.vod_id, body.streamer_login));
      }
      case "solo_resume":
        return json(await soloResume(body.run_id));
      case "solo_status": {
        const q = sb.from("agent_runs").select("*").order("created_at", { ascending: false }).limit(1);
        const { data } = body.run_id ? await sb.from("agent_runs").select("*").eq("id", body.run_id).maybeSingle() : await q.maybeSingle();
        return json({ run: data || null });
      }
      case "submit_feedback":
        return json(await submitFeedback(body));
      case "get_dashboard":
        return json(await getDashboard());
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("intelligent-vod-agent error:", msg);
    return json({ error: msg }, 500);
  }
});
