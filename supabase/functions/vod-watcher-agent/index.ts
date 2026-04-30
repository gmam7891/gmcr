// ============================================================================
// VOD Watcher AI — Autonomous Background Agent (storyboards edition)
// ----------------------------------------------------------------------------
// IMPORTANT 2026-04: Twitch deprecated `thumb<ts>-WxH.jpg` per-timestamp URLs
// (all 404). We now use the official storyboard mosaics returned by the
// `seekPreviewsURL` GraphQL field. Each storyboard image is a JPEG grid of
// (cols × rows) tiles, one tile every `interval` seconds.
//
// Strategy:
//   - On `start`, fetch storyboard info.json (high quality preferred).
//   - Pre-compute storyboard image URLs and their (mosaic, row, col, ts) for
//     every tile. This is our "frames plan".
//   - On each `resume` chunk we send entire mosaic images to Gemini with an
//     instruction explaining the grid layout. The model returns which tiles
//     contain casino content (by row/col index). One API call covers up to
//     50 frames at a time, so we burn through long VODs quickly.
//   - Persist detections to raw_evidences (vod_id-keyed) so the existing
//     report builder keeps working unchanged.
//
// Fallback: if storyboards are unavailable for a VOD, mark audit failed with
// a clear error_message so the UI can explain it.
//
// Actions: start | resume | report
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { handleWrite } from "../_shared/scanner-actions.ts";

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GQL_URL = "https://gql.twitch.tv/gql";
const GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

const MOSAICS_PER_CHUNK = 4;          // process up to 4 storyboard mosaics per HTTP chunk
const CHECKPOINT_FRAMES = 50;         // persist progress every N frames within a chunk
const MAX_RETRIES = 3;                // exponential backoff retries for AI / Twitch
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";

// Forensic prompt tailored for mosaic analysis. The model receives ONE image
// (the storyboard) and must return per-tile state classifications referenced by row/col.
//
// The MOSAIC_PROMPT is built dynamically per-audit by appending the compacted
// game_visual_library context (see buildMosaicPrompt). This forces the AI to
// match against our known catalog instead of hallucinating famous game names.

const MOSAIC_PROMPT_BASE = `Você está analisando frames de VOD da Twitch de streamers brasileiros de cassino online.

A IMAGEM enviada é um STORYBOARD: um grid de THUMBNAILS pequenos (tiles) extraídos do VOD.
Você receberá GRID_COLS, GRID_ROWS, TILE_COUNT e o TIMESTAMP de cada tile.
Ordem dos tiles: linha por linha, da esquerda para a direita, de cima para baixo.

A categoria/capítulo da Twitch é APENAS UM SINAL AUXILIAR DE CONTEXTO. Ela NÃO deve ser usada como prova principal, não deve gerar detecção sozinha e não deve substituir a análise visual dos tiles.

Para CADA tile, classifique:

═══════════════════════════════════════════════════════════════
1. SCREEN_STATE (escolha APENAS UM):
═══════════════════════════════════════════════════════════════
- "lobby": Grade/lista de múltiplos jogos para escolher (thumbnails lado a lado com nomes embaixo). NÃO está jogando ativamente.
- "loading": Tela de carregamento com logo grande de jogo/provedora. Pode ter barra de progresso. SEM rolos girando ou interface de aposta.
- "gameplay": JOGANDO ATIVAMENTE. Interface completa: rolos com símbolos, mesa de aposta, controles "spin"/"bet"/"deal", valores R$ visíveis.
- "other": Just Chatting, navegador, desktop, IRL, ou qualquer coisa NÃO-cassino.

═══════════════════════════════════════════════════════════════
2. GAME_NAME (REGRA CRÍTICA — leia com atenção)
═══════════════════════════════════════════════════════════════
Eu te dou abaixo a BIBLIOTECA OFICIAL de jogos conhecidos no formato:
  NomeDoJogo|Provedora|palavra1,palavra2,palavra3

REGRAS DE IDENTIFICAÇÃO:
a) Se SCREEN_STATE = "gameplay" OU "loading":
   - Tente identificar o jogo procurando na BIBLIOTECA OFICIAL abaixo
   - Use os símbolos visuais, layout, cores e textos visíveis no tile
   - Compare contra as "palavras" de cada jogo (são pistas visuais únicas)
   - Se ENCONTRAR um jogo da biblioteca: retorne game_name EXATAMENTE como está na biblioteca
   - Se NÃO encontrar nada parecido na biblioteca: retorne game_name = null

b) NUNCA retorne um game_name que NÃO ESTÁ na biblioteca abaixo
   - Exceção: se você lê CLARAMENTE o nome do jogo no canto da tela (texto legível)
     e ele não está na biblioteca, retorne o nome lido com confidence baixa (0.4-0.6)
     e marque is_unknown_game=true

c) Em caso de dúvida entre 2 jogos parecidos: retorne null com confidence baixa
   - Prefira ADMITIR INCERTEZA a chutar
   - "Tema parecido" NÃO é match (ex: 2 jogos egípcios diferentes não são o mesmo)

d) Se SCREEN_STATE = "lobby" ou "other": SEMPRE game_name = null
   - Lobby mostra jogos disponíveis, mas o streamer NÃO está jogando eles ainda

═══════════════════════════════════════════════════════════════
3. PROVIDER_NAME
═══════════════════════════════════════════════════════════════
- Se identificou GAME_NAME da biblioteca: retorne a provedora EXATA da biblioteca
- Se for "loading" mostrando logo grande de provedora (ex: PRAGMATIC PLAY): retorne ela
- Se vê logo de provedora visível (ex: PG SOFT no canto inferior): retorne ela
- Caso contrário: null

═══════════════════════════════════════════════════════════════
4. CASINO_BRAND (casa de aposta visível)
═══════════════════════════════════════════════════════════════
Procure logos no topo da tela ou rodapé. Casas brasileiras conhecidas:
SeuBet, Pixbet, KTO, Bet7K, Stake, Betano, Sportingbet, Betfair,
Galera.bet, Esportes da Sorte, Bet Nacional, Lotogreen, F12 Bet,
Betpix, Blaze, Estrela Bet.
Se identificar, retorne. Caso contrário, null.

═══════════════════════════════════════════════════════════════
5. CONFIDENCE (0.0 a 1.0)
═══════════════════════════════════════════════════════════════
- 0.9+ : Match claro com jogo da biblioteca, símbolos/cores/HUD batem
- 0.7-0.9 : Provavelmente é o jogo X da biblioteca, mas thumb pequena
- 0.5-0.7 : Reconheço categoria (slot/crash/roleta) mas não o jogo específico
- < 0.5 : Chute educado — PREFIRA retornar null com confidence baixa

═══════════════════════════════════════════════════════════════
6. EVIDENCE — justificativa em 1 frase curta (pt-BR)
═══════════════════════════════════════════════════════════════
Ex: "logo PUNK ROCKER em neon rosa, fundo escuro = Punk Rocker (Nolimit City)"
    "rolos 6x5 com símbolos coloridos roxo+dourado, multiplicadores tumblers = Gates of Olympus 1000"
    "logo SeuBet no topo, grade de slots = lobby"
    "tela com logo grande Pragmatic Play e barra carregando"

═══════════════════════════════════════════════════════════════
DICAS PARA RECONHECER PROVEDORAS DE NICHO (não estão na biblioteca):
═══════════════════════════════════════════════════════════════
Existem provedoras NÃO cobertas pela biblioteca que aparecem em VODs
brasileiros. NÃO chute jogos famosos quando ver essas — retorne null:
- Slingshot Studios (sub de Games Global): "Wacky Panda", "Area Link Bank Boss",
  "Area Link Phoenix Firestorm" — costumam ter logo "SLINGSHOT" no loading
- PearFiction Studios: "Squealin Riches", "Treasures of Mjolnir",
  "VoltedUP WildSurge" — logo "Pear Fiction studios" no rodapé
- 3 Oaks Gaming: "Inca Queen" e outros — costumam ter design tropical
- Spribe: jogos de crash (não slots) — Aviator, Mines, etc.

Se o frame mostra jogo de uma dessas provedoras, retorne game_name=null
mas marque o provider_name se conseguir identificar pelo logo.

═══════════════════════════════════════════════════════════════
FORMATO DA RESPOSTA — JSON ARRAY puro (SEM \`\`\`json wrapper):
═══════════════════════════════════════════════════════════════
[
  {
    "row": 0, "col": 2,
    "screen_state": "gameplay",
    "game_name": "Gates of Olympus 1000",
    "provider_name": "Pragmatic Play",
    "casino_brand": "SeuBet",
    "is_unknown_game": false,
    "confidence": 0.95,
    "evidence": "rolos 6x5 com Zeus à direita, multiplicadores 5x, logo SeuBet no topo"
  },
  {
    "row": 0, "col": 3,
    "screen_state": "loading",
    "game_name": "Wacky Panda Power Combo",
    "provider_name": "Games Global",
    "casino_brand": "SeuBet",
    "is_unknown_game": true,
    "confidence": 0.6,
    "evidence": "logo Wacky Panda visível, mas jogo não está na biblioteca oficial"
  }
]

REGRAS ABSOLUTAS:
- NÃO INVENTE jogos. Use APENAS a biblioteca abaixo, ou null.
- NÃO atribua jogos do LOBBY como "jogados". Lobby = game_name null.
- Se não tem certeza ABSOLUTA, retorne null com confidence baixa.
- Frames muito borrados/pequenos: retorne screen_state="other" com confidence baixa.

═══════════════════════════════════════════════════════════════
BIBLIOTECA OFICIAL DE JOGOS (formato: nome|provedora|pistas visuais):
═══════════════════════════════════════════════════════════════
`;

function buildMosaicPrompt(libraryContext: string): string {
  return MOSAIC_PROMPT_BASE + libraryContext;
}

// Normaliza variantes conhecidas de nomes de provedora.
function normalizeProviderName(name: string | null | undefined): string {
  if (!name) return "Unknown";
  const normalized = String(name).trim();
  if (!normalized) return "Unknown";
  const aliases: Record<string, string> = {
    "hacksaw gaming": "Hacksaw",
    "hacksaw": "Hacksaw",
    "nolimit city": "Nolimit City",
    "no limit city": "Nolimit City",
    "pragmatic": "Pragmatic Play",
  };
  return aliases[normalized.toLowerCase()] || normalized;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseAIBatch(raw: string): any[] {
  if (!raw || typeof raw !== "string") return [];

  // Strip markdown code fences if present (Gemini Flash often wraps in ```json...```)
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "");
  cleaned = cleaned.replace(/\n?\s*```\s*$/i, "");
  cleaned = cleaned.trim();

  try {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try { return JSON.parse(match[0]); } catch {
      const lastBrace = match[0].lastIndexOf("}");
      if (lastBrace > 0) {
        try { return JSON.parse(match[0].substring(0, lastBrace + 1) + "]"); } catch { return []; }
      }
      return [];
    }
  } catch { return []; }
}

async function withRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = MAX_RETRIES): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const delay = Math.min(8000, 500 * Math.pow(2, attempt - 1)) + Math.random() * 250;
      console.warn(`[Watcher] ${label} attempt ${attempt}/${maxAttempts} failed: ${(e as Error).message}. Retrying in ${Math.round(delay)}ms`);
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

async function callAI(messages: any[]): Promise<{ items: any[]; ok: boolean; status: number; raw: string }> {
  try {
    return await withRetry("ai-gateway", async () => {
      const res = await fetch(AI_GATEWAY, {
        method: "POST",
        headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "google/gemini-2.5-flash", messages, max_tokens: 8192 }),
      });
      // Don't retry 4xx — they won't fix themselves
      if (res.status === 429 || res.status === 402 || res.status >= 500) {
        const txt = await res.text().catch(() => "");
        throw new Error(`gateway ${res.status}: ${txt.slice(0, 120)}`);
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return { items: [], ok: false, status: res.status, raw: txt };
      }
      const data = await res.json();
      const raw = data?.choices?.[0]?.message?.content ?? "[]";
      return { items: parseAIBatch(raw), ok: true, status: 200, raw };
    });
  } catch (e) {
    console.warn(`[Watcher] AI call exhausted retries: ${(e as Error).message}`);
    return { items: [], ok: false, status: 0, raw: String(e) };
  }
}

async function fetchChapters(vodId: string): Promise<any[]> {
  try {
    const res = await fetch(GQL_URL, {
      method: "POST",
      headers: { "Client-ID": GQL_CLIENT_ID, "Content-Type": "application/json" },
      body: JSON.stringify({
        operationName: "VideoPlayer_ChapterSelectButtonVideo",
        variables: { videoID: String(vodId) },
        extensions: { persistedQuery: { version: 1, sha256Hash: "8d2793384aac3773beab5e59bd5d6f585aedb923d292800571571c2d1f41881c" } },
      }),
    });
    const data = await res.json();
    const moments = data?.data?.video?.moments?.edges ?? [];
    return moments.map((edge: any) => ({
      positionSeconds: Math.round(edge.node.positionMilliseconds / 1000),
      durationSeconds: Math.round(edge.node.durationMilliseconds / 1000),
      game: edge.node.details?.game?.displayName ?? edge.node.description,
    }));
  } catch (e) {
    console.warn("[Watcher] chapter fetch failed:", e);
    return [];
  }
}

async function fetchVodCreatedAt(vodId: string): Promise<string | null> {
  try {
    const twitchRes = await fetch(`${SUPABASE_URL}/functions/v1/twitch-api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ action: "get_vod", vod_id: vodId }),
    });
    if (!twitchRes.ok) return null;
    const vodData = await twitchRes.json();
    const createdAt = vodData?.created_at || vodData?.data?.[0]?.created_at;
    return createdAt ? new Date(createdAt).toISOString() : null;
  } catch (e) {
    console.warn("[Watcher] VOD created_at fetch failed:", e);
    return null;
  }
}

// Fetch the storyboard descriptor + URLs.
// Returns null when storyboards are unavailable (very fresh VOD, deleted, etc).
async function fetchStoryboardPlan(vodId: string): Promise<
  | {
      mosaics: Array<{ url: string; cols: number; rows: number; tile_w: number; tile_h: number; tiles: Array<{ row: number; col: number; ts: number }> }>;
      interval: number;
      total_tiles: number;
    }
  | null
> {
  // 1. Get seekPreviewsURL via GraphQL (with retry — Twitch GQL flakes)
  const gqlBody = await withRetry("twitch-gql-storyboard", async () => {
    const r = await fetch(GQL_URL, {
      method: "POST",
      headers: { "Client-ID": GQL_CLIENT_ID, "Content-Type": "application/json" },
      body: JSON.stringify({ query: `query{video(id:"${vodId}"){seekPreviewsURL}}` }),
    });
    if (!r.ok) throw new Error(`gql ${r.status}`);
    return await r.json();
  }).catch((e) => { console.warn(`[Watcher] storyboard gql exhausted: ${e.message}`); return null; });
  const infoUrl: string | undefined = gqlBody?.data?.video?.seekPreviewsURL;
  if (!infoUrl) return null;

  // 2. Fetch the info.json (with retry)
  const variants: any[] = await withRetry("storyboard-info-json", async () => {
    const r = await fetch(infoUrl);
    if (!r.ok) throw new Error(`info ${r.status}`);
    return await r.json();
  }).catch(() => []);
  if (!Array.isArray(variants) || variants.length === 0) return null;

  console.log(
    `[storyboard] All variants for VOD ${vodId}: ` +
    variants.map((v: any) => `${v.quality}(${v.count}t,${v.interval}s)`).join(", ")
  );

  // Pick the variant with most tiles. Tiebreaker: largest tile area.
  const variant = variants.reduce((best: any, v: any) => {
    if (!best) return v;
    const bestCount = best?.count || 0;
    const vCount = v?.count || 0;
    if (vCount > bestCount) return v;
    if (vCount < bestCount) return best;

    const bestArea = (best?.width || 0) * (best?.height || 0);
    const vArea = (v?.width || 0) * (v?.height || 0);
    return vArea > bestArea ? v : best;
  }, null) ?? variants[variants.length - 1];
  console.log(
    `[storyboard] Selected "${variant.quality}" with ${variant.count} tiles, ` +
    `interval ${variant.interval}s, tile ${variant.width}x${variant.height}.`
  );
  const { count, cols, rows, width, height, interval, images } = variant;
  if (!count || !cols || !rows || !width || !height || !interval || !Array.isArray(images)) return null;

  // 3. Compute base URL (info.json sits next to the storyboard images)
  const baseUrl = infoUrl.substring(0, infoUrl.lastIndexOf("/") + 1);
  const tilesPerImage = cols * rows;

  const mosaics = images.map((imgName: string, mosaicIdx: number) => {
    const tiles: Array<{ row: number; col: number; ts: number }> = [];
    const startGlobal = mosaicIdx * tilesPerImage;
    const endGlobal = Math.min(startGlobal + tilesPerImage, count);
    for (let g = startGlobal; g < endGlobal; g++) {
      const localIdx = g - startGlobal;
      tiles.push({
        row: Math.floor(localIdx / cols),
        col: localIdx % cols,
        ts: Math.round(g * interval + interval / 2), // midpoint timestamp
      });
    }
    return { url: baseUrl + imgName, cols, rows, tile_w: width, tile_h: height, tiles };
  });

  return { mosaics, interval, total_tiles: count };
}

async function selfInvokeResume(auditId: string) {
  const url = `${SUPABASE_URL}/functions/v1/vod-watcher-agent`;
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ action: "resume", audit_id: auditId }),
  }).catch((e) => console.warn("[Watcher] self-invoke failed:", e));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!LOVABLE_API_KEY) return jsonResponse({ error: "LOVABLE_API_KEY not configured" }, 500);
  if (!SUPABASE_URL || !SERVICE_KEY) return jsonResponse({ error: "Supabase env not configured" }, 500);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }
  const { action } = body;

  // ─────────────────────────────────────────────────────────────────────────
  // ACTION: start
  // ─────────────────────────────────────────────────────────────────────────
  if (action === "start") {
    const { vod_id, streamer_login, vod_duration_seconds, thumbnail_url, vod_title } = body;
    if (!vod_id || !streamer_login || !vod_duration_seconds) {
      return jsonResponse({ error: "vod_id, streamer_login, vod_duration_seconds required" }, 400);
    }

    const totalMinutes = Math.round(vod_duration_seconds / 60);

    // Fetch storyboard plan + chapters + VOD created_at in parallel
    const [storyboard, chapters, vodCreatedAt] = await Promise.all([
      Promise.race([
        fetchStoryboardPlan(vod_id),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]),
      Promise.race([
        fetchChapters(vod_id),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 8000)),
      ]),
      Promise.race([
        fetchVodCreatedAt(vod_id),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]),
    ]);

    if (!storyboard || storyboard.mosaics.length === 0) {
      // Hard fail with clear message — UI can explain
      const auditPayload = {
        vod_id,
        streamer_login,
        platform: "twitch",
        status: "failed" as const,
        vod_duration_seconds: Math.round(vod_duration_seconds),
        vod_created_at: vodCreatedAt,
        expected_frames: 0,
        processed_frames: 0,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        error_message: "Storyboards indisponíveis para este VOD (Twitch removeu thumbs por timestamp). Tente um VOD mais recente.",
        progress_phase: "failed",
        progress_message: "Sem fonte de imagens — Twitch não expôs storyboards para este VOD.",
        sullygnome_snapshot: {},
        pending_audit_segments: { plan: null, flagged: [] } as any,
      };
      const { data: row } = await sb.from("vod_audits").upsert(auditPayload, { onConflict: "vod_id,platform" }).select("id").single();
      return jsonResponse({
        audit_id: row?.id,
        total_frames: 0,
        total_minutes: totalMinutes,
        chapters: chapters?.length ?? 0,
        message: "Storyboards indisponíveis — auditoria não pôde iniciar.",
      });
    }

    const totalFrames = storyboard.total_tiles;
    // Sanity check: VOD recente pode estar com storyboard ainda processando.
    // Threshold: pelo menos 1 tile a cada 60s do VOD.
    const minExpectedTiles = Math.max(20, Math.floor(vod_duration_seconds / 60));
    if (totalFrames < minExpectedTiles) {
      console.warn(
        `[storyboard] VOD ${vod_id}: only ${totalFrames} tiles for ${vod_duration_seconds}s VOD. ` +
        `Expected at least ${minExpectedTiles}. Storyboard may still be processing on Twitch's side. ` +
        `Proceeding anyway, but precision will be lower.`
      );
    }

    const auditPayload = {
      vod_id,
      streamer_login,
      platform: "twitch",
      status: "processing" as const,
      vod_duration_seconds: Math.round(vod_duration_seconds),
      vod_created_at: vodCreatedAt,
      expected_frames: totalFrames,
      processed_frames: 0,
      started_at: new Date().toISOString(),
      completed_at: null,
      error_message: null,
      progress_phase: "starting",
      progress_total_minutes: totalMinutes,
      progress_current_minute: 0,
      progress_games_found: 0,
      progress_message: `Plano: ${storyboard.mosaics.length} mosaicos | ${totalFrames} frames | ${chapters.length} capítulos`,
      sullygnome_snapshot: {},
      pending_audit_segments: {
        plan: {
          mosaics: storyboard.mosaics,
          interval: storyboard.interval,
          chapters,
          vod_title: vod_title || "",
          processed_mosaic: 0,
        },
        flagged: [],
      } as any,
    };

    const { data: auditRow, error: auditErr } = await sb
      .from("vod_audits")
      .upsert(auditPayload, { onConflict: "vod_id,platform" })
      .select("id")
      .single();

    if (auditErr || !auditRow) {
      console.error("[Watcher] failed to upsert audit:", auditErr);
      return jsonResponse({ error: `Failed to create audit: ${auditErr?.message}` }, 500);
    }

    // SullyGnome enrichment (background)
    EdgeRuntime.waitUntil((async () => {
      try {
        const sully = await sb.functions.invoke("sullygnome-scraper", {
          body: { action: "scrape", streamer_login },
        });
        if (sully?.data) {
          await sb.from("vod_audits").update({ sullygnome_snapshot: sully.data })
            .eq("id", auditRow.id);
        }
      } catch (e) { console.warn("[Watcher] SullyGnome background fetch failed:", e); }
    })());

    selfInvokeResume(auditRow.id);

    return jsonResponse({
      audit_id: auditRow.id,
      total_frames: totalFrames,
      total_minutes: totalMinutes,
      chapters: chapters.length,
      message: "Agente iniciado em background — feche a página, ele continua processando.",
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACTION: resume — process next mosaics chunk
  // ─────────────────────────────────────────────────────────────────────────
  if (action === "resume") {
    const { audit_id } = body;
    if (!audit_id) return jsonResponse({ error: "audit_id required" }, 400);

    const { data: audit, error: loadErr } = await sb
      .from("vod_audits")
      .select("*")
      .eq("id", audit_id)
      .single();

    if (loadErr || !audit) return jsonResponse({ error: "audit not found" }, 404);
    if (audit.status === "completed" || audit.status === "failed") {
      return jsonResponse({ status: audit.status, message: "already finished" });
    }

    const segments = (audit.pending_audit_segments as any) || {};
    const plan = segments.plan;
    const flagged: any[] = segments.flagged || [];
    if (!plan || !Array.isArray(plan.mosaics)) {
      await sb.from("vod_audits").update({
        status: "failed",
        error_message: "Plano de execução inválido",
        completed_at: new Date().toISOString(),
      }).eq("id", audit_id);
      return jsonResponse({ error: "no plan" }, 500);
    }

    const totalMinutes = Math.round(audit.vod_duration_seconds / 60);
    const startIdx = plan.processed_mosaic || 0;
    const endIdx = Math.min(startIdx + MOSAICS_PER_CHUNK, plan.mosaics.length);

    if (startIdx >= plan.mosaics.length) {
      await finalizeAudit(sb, audit, flagged);
      return jsonResponse({ status: "completed" });
    }

    console.log(`[Watcher ${audit_id}] processing mosaics ${startIdx}-${endIdx} of ${plan.mosaics.length}`);

    let totalDetectionsThisChunk = 0;
    let framesSinceCheckpoint = 0;
    const batchId = `${audit_id}-${Date.now()}`;

    // ─────────────────────────────────────────────────────────────────────
    // Load game_visual_library once per resume chunk and compact it into
    // the prompt so the AI matches against our known catalog instead of
    // hallucinating famous game names.
    // ─────────────────────────────────────────────────────────────────────
    console.log(`[Watcher ${audit.id}] Loading game_visual_library...`);
    const { data: libraryRows, error: libErr } = await sb
      .from("game_visual_library")
      .select("game_name, provider_name, visual_dna")
      .eq("training_status", "trained");

    if (libErr) {
      console.warn(`[Watcher ${audit.id}] Failed to load library: ${libErr.message}`);
    }

    const gameLibrary: Array<{
      name: string;
      provider: string;
      keywords: string[];
    }> = (libraryRows || []).map((row: any) => {
      const dna = row.visual_dna || {};
      const provider = normalizeProviderName(
        dna.provider_canonical || row.provider_name || "Unknown",
      );
      const keywords = Array.isArray(dna.detection_keywords)
        ? dna.detection_keywords.slice(0, 6).map((k: any) => String(k))
        : [];
      return { name: row.game_name, provider, keywords };
    });

    console.log(
      `[Watcher ${audit.id}] Library loaded: ${gameLibrary.length} games, ` +
      `providers=${new Set(gameLibrary.map((g) => g.provider)).size}`,
    );

    // Compact library: "GameName|Provider|kw1,kw2,kw3,kw4" per line
    const libraryContext = gameLibrary
      .map((g) => `${g.name}|${g.provider}|${g.keywords.slice(0, 4).join(",")}`)
      .join("\n");

    console.log(
      `[Watcher ${audit.id}] Library context: ${libraryContext.length} chars, ` +
      `~${Math.round(libraryContext.length / 4)} tokens`,
    );

    const mosaicPrompt = buildMosaicPrompt(libraryContext);

    // Index para validação rápida (case-insensitive) por nome do jogo
    const libraryIndex = new Map<string, { name: string; provider: string }>();
    for (const g of gameLibrary) {
      libraryIndex.set(g.name.toLowerCase(), { name: g.name, provider: g.provider });
    }


    // Helper to persist a checkpoint (so a timeout mid-chunk doesn't lose state)
    const checkpoint = async (currentMosaic: number, label: string) => {
      plan.processed_mosaic = currentMosaic;
      await sb.from("vod_audits").update({
        progress_message: label,
        last_checkpoint_at: new Date().toISOString(),
        pending_audit_segments: { plan, flagged } as any,
      }).eq("id", audit_id);
    };

    for (let mIdx = startIdx; mIdx < endIdx; mIdx++) {
      const mosaic = plan.mosaics[mIdx];
      if (!mosaic?.url || !Array.isArray(mosaic.tiles)) continue;

      const firstTs = mosaic.tiles[0]?.ts ?? 0;
      const lastTs = mosaic.tiles[mosaic.tiles.length - 1]?.ts ?? firstTs;
      const chapterAt = (plan.chapters || []).find((ch: any) =>
        firstTs >= ch.positionSeconds && firstTs < (ch.positionSeconds + ch.durationSeconds),
      );
      const chapterCategory = chapterAt?.game || "Unknown";

      const tileLabel = mosaic.tiles
        .map((t: any) => `(r${t.row},c${t.col})=${Math.floor(t.ts / 60)}min`)
        .join(", ");

      const userText = `MOSAICO ${mIdx + 1}/${plan.mosaics.length} do VOD "${plan.vod_title}".
GRID_COLS=${mosaic.cols}, GRID_ROWS=${mosaic.rows}, TILE_COUNT=${mosaic.tiles.length}.
Tile size: ${mosaic.tile_w}×${mosaic.tile_h} px.
Categoria Twitch auxiliar: ${chapterCategory}.
Timestamps por tile: ${tileLabel}.
Use a categoria Twitch apenas como contexto secundário; identifique cassino somente quando houver evidência visual no tile.`;

      const ai = await callAI([
        { role: "system", content: mosaicPrompt },
        { role: "user", content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: mosaic.url, detail: "high" } },
        ] },
      ]);

      console.log(
        `[Watcher ${audit.id}] AI mosaic ${mIdx + 1}/${plan.mosaics.length} ` +
        `(tiles=${mosaic.tiles.length} ${mosaic.cols}x${mosaic.rows} ` +
        `tile_size=${mosaic.tile_w}x${mosaic.tile_h}): ` +
        `ok=${ai.ok} status=${ai.status} ` +
        `items=${ai.items?.length ?? 0} ` +
        `raw_preview="${(ai.raw || "").slice(0, 500).replace(/\s+/g, " ")}"`
      );

      let detections = ai.items;

      const casinoHints = ["virtual casino", "slots", "casino", "gambling"];
      const isCasinoChapter = casinoHints.some((k) => chapterCategory.toLowerCase().includes(k));
      if (isCasinoChapter && detections.length === 0) {
        const retry = await callAI([
          { role: "system", content: MOSAIC_PROMPT + "\n\nESTE MOSAICO COBRE PERÍODO CONFIRMADO COMO CASSINO. Identifique TODOS os tiles que tenham slot/cassino visível, mesmo se a thumb for baixa resolução." },
          { role: "user", content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: mosaic.url, detail: "high" } },
          ] },
        ]);
        console.log(
          `[Watcher ${audit.id}] AI mosaic ${mIdx + 1}/${plan.mosaics.length} ` +
          `(tiles=${mosaic.tiles.length} ${mosaic.cols}x${mosaic.rows} ` +
          `tile_size=${mosaic.tile_w}x${mosaic.tile_h}): ` +
          `ok=${retry.ok} status=${retry.status} ` +
          `items=${retry.items?.length ?? 0} ` +
          `raw_preview="${(retry.raw || "").slice(0, 500).replace(/\s+/g, " ")}"`
        );
        if (retry.items.length > 0) {
          detections = retry.items;
        } else {
          flagged.push({
            mosaic_index: mIdx,
            chapter_category: chapterCategory,
            mosaic_url: mosaic.url,
            ts_window: [firstTs, lastTs],
            reason: "AI_could_not_identify_in_known_casino_window",
          });
        }
      }

      // ── SSoT: write detections into stream_snapshots ──────────────────────
      const snapshotRows: any[] = [];
      const rawEvidenceRows: any[] = [];
      for (const det of detections) {
        const row = Number(det.row);
        const col = Number(det.col);
        if (!Number.isInteger(row) || !Number.isInteger(col)) continue;

        const tile = mosaic.tiles.find((t: any) => t.row === row && t.col === col);
        if (!tile) continue;

        const rawConfidence = Number(det.confidence);
        const conf = Number.isFinite(rawConfidence)
          ? Math.max(0, Math.min(1, rawConfidence))
          : 0.5;

        const rawScreenState = String(det.screen_state || "other").toLowerCase();
        const screenState = ["lobby", "loading", "gameplay", "other"].includes(rawScreenState)
          ? rawScreenState
          : "other";

        // game_name SOMENTE em gameplay ou loading com jogo identificável
        // NUNCA atribuir jogos do lobby como "jogados"
        const gameName = (screenState === "gameplay" || screenState === "loading")
          ? (det.game_name || null)
          : null;

        const providerName = (screenState === "gameplay" || screenState === "loading")
          ? (det.provider_name || null)
          : null;

        // casino_brand pode aparecer em qualquer estado (exceto "other")
        const casinoBrand = screenState !== "other"
          ? (det.casino_brand || null)
          : null;

        const commonMetadata = {
          chapter_category: chapterCategory,
          screen_state: screenState,
          casino_brand: casinoBrand,
          mosaic_url: mosaic.url,
          tile_row: row,
          tile_col: col,
          evidence: det.evidence || null,
        };

        snapshotRows.push({
          streamer_login: audit.streamer_login,
          vod_id: audit.vod_id,
          source: "storyboard",
          captured_at: new Date(Date.now() - (audit.vod_duration_seconds - tile.ts) * 1000).toISOString(),
          is_live: false,
          game_name: gameName,
          game_detected: gameName,
          provider_detected: providerName,
          confidence_score: conf,
          ai_confidence: conf,
          ai_evidence: det.evidence || null,
          is_ai_verified: conf >= 0.85,
          frame_index: mIdx * (mosaic.cols * mosaic.rows) + (row * mosaic.cols + col),
          timestamp_seconds: tile.ts,
          processing_batch_id: batchId,
          viewer_count: 0,
          extra_metadata: commonMetadata,
        });

        rawEvidenceRows.push({
          vod_id: audit.vod_id,
          source_id: audit.vod_id,
          streamer_login: audit.streamer_login,
          platform: "twitch",
          source_type: "vod",
          timestamp_seconds: tile.ts,
          frame_index: mIdx * (mosaic.cols * mosaic.rows) + (row * mosaic.cols + col),
          game_detected: gameName,
          provider_detected: providerName,
          confidence_score: conf,
          screen_state: screenState,
          // is_valid SOMENTE em gameplay efetivo com jogo identificado
          is_valid: screenState === "gameplay" && !!gameName,
          validation_status: "pending",
          processing_batch_id: batchId,
          casino_brand: casinoBrand,
          extra_metadata: commonMetadata,
        });
      }
      if (snapshotRows.length > 0) {
        const { error: snapErr } = await sb.from("stream_snapshots").insert(snapshotRows);
        if (snapErr) console.warn("[Watcher] snapshot insert failed:", snapErr.message);
        const { error: rawErr } = await sb.from("raw_evidences").insert(rawEvidenceRows);
        if (rawErr) console.warn("[Watcher] raw evidence insert failed:", rawErr.message);
        else {
          totalDetectionsThisChunk += snapshotRows.length;
          framesSinceCheckpoint += snapshotRows.length;
        }
      }

      // ── Checkpoint every CHECKPOINT_FRAMES detected frames ────────────────
      if (framesSinceCheckpoint >= CHECKPOINT_FRAMES) {
        await checkpoint(mIdx + 1, `Checkpoint: mosaico ${mIdx + 1}/${plan.mosaics.length} (+${framesSinceCheckpoint} frames)`);
        framesSinceCheckpoint = 0;
      }
    }

    // Update progress + plan (final state for this chunk)
    plan.processed_mosaic = endIdx;
    const processedFrames = endIdx * (plan.mosaics[0]?.cols || 5) * (plan.mosaics[0]?.rows || 10);
    const cappedProcessed = Math.min(processedFrames, audit.expected_frames || processedFrames);
    const currentMin = Math.round(((endIdx / plan.mosaics.length) * (audit.vod_duration_seconds || 0)) / 60);

    const { data: gamesCount } = await sb
      .from("stream_snapshots")
      .select("game_detected")
      .eq("vod_id", audit.vod_id)
      .eq("source", "storyboard")
      .not("game_detected", "is", null);
    const uniqueGames = new Set((gamesCount || []).map((r: any) => r.game_detected)).size;

    await sb.from("vod_audits").update({
      progress_phase: "analyzing",
      progress_current_minute: currentMin,
      progress_games_found: uniqueGames,
      progress_message: `Agente assistindo... mosaico ${endIdx}/${plan.mosaics.length} | ${uniqueGames} jogos detectados (+${totalDetectionsThisChunk} frames)`,
      processed_frames: cappedProcessed,
      last_checkpoint_at: new Date().toISOString(),
      pending_audit_segments: { plan, flagged } as any,
    }).eq("id", audit_id);

    if (endIdx < plan.mosaics.length) {
      selfInvokeResume(audit_id);
      return jsonResponse({
        status: "chunk_done",
        processed_mosaic: endIdx,
        total_mosaics: plan.mosaics.length,
      });
    }

    await finalizeAudit(sb, audit, flagged);
    return jsonResponse({ status: "completed" });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACTION: report — consolidated audit report
  // ─────────────────────────────────────────────────────────────────────────
  if (action === "report") {
    const { audit_id } = body;
    if (!audit_id) return jsonResponse({ error: "audit_id required" }, 400);

    const { data: audit } = await sb.from("vod_audits").select("*").eq("id", audit_id).single();
    if (!audit) return jsonResponse({ error: "audit not found" }, 404);

    // ── SSoT: stream_snapshots is the single source of truth ────────────────
    // 1) Try storyboard-source detections first (vod_id-bound, AI-verified).
    const { data: storyboardSnaps } = await sb
      .from("stream_snapshots")
      .select("game_detected, provider_detected, confidence_score, ai_confidence, timestamp_seconds, is_ai_verified, extra_metadata, ai_evidence")
      .eq("vod_id", audit.vod_id)
      .eq("source", "storyboard")
      .not("game_detected", "is", null);

    const interval =
      audit.expected_frames && audit.vod_duration_seconds
        ? Math.max(1, Math.round(audit.vod_duration_seconds / audit.expected_frames))
        : 39;

    const { data: allEvidences } = await sb.from("raw_evidences").select("screen_state")
      .eq("vod_id", audit.vod_id);
    const stateBreakdown = {
      gameplay_seconds: 0,
      lobby_seconds: 0,
      loading_seconds: 0,
      other_seconds: 0,
    };
    for (const ev of (allEvidences || [])) {
      const state = (ev.screen_state || "gameplay") as "gameplay" | "lobby" | "loading" | "other";
      const key = `${state}_seconds` as keyof typeof stateBreakdown;
      if (stateBreakdown[key] !== undefined) {
        stateBreakdown[key] += interval;
      }
    }

    const byGame = new Map<string, { game: string; provider: string; frames: number; seconds: number; avgConfidence: number; pendingFrames: number; status?: "confirmed" | "suspect"; proof?: any; }>();

    const pushDetection = (game: string, provider: string, conf: number, secs: number, proof?: any) => {
      const key = `${game}|${provider}`;
      const existing = byGame.get(key);
      if (existing) {
        existing.frames += 1;
        existing.seconds += secs;
        existing.avgConfidence = (existing.avgConfidence * (existing.frames - 1) + conf) / existing.frames;
        if (conf < 0.85) existing.pendingFrames += 1;
        if (!existing.proof && proof) existing.proof = proof;
      } else {
        byGame.set(key, {
          game, provider,
          frames: 1, seconds: secs,
          avgConfidence: conf,
          pendingFrames: conf < 0.85 ? 1 : 0,
          proof,
        });
      }
    };

    for (const s of storyboardSnaps || []) {
      pushDetection(
        s.game_detected!,
        s.provider_detected || "Unknown",
        Number(s.ai_confidence ?? s.confidence_score ?? 0),
        interval,
        (s.extra_metadata as any)?.transition_evidence || {
          proof_image_url: (s.extra_metadata as any)?.mosaic_url || null,
          timestamp_seconds: s.timestamp_seconds,
          detection_type: (s.extra_metadata as any)?.detection_type || "gameplay",
          evidence: s.ai_evidence || null,
        },
      );
    }

    let dataSource: "stream_snapshots:storyboard" | "stream_snapshots:live" | "none" =
      byGame.size > 0 ? "stream_snapshots:storyboard" : "none";
    let diagnosticLog: string | null = null;
    let snapshotsFound = (storyboardSnaps || []).length;

    // ── 2) Fallback: live monitor snapshots (Twitch category-based) ─────────
    if (byGame.size === 0) {
      // =================================================================
      // FALLBACK: stream_snapshots — filtrar pela janela temporal real do VOD
      // =================================================================
      // Bug fix: antes pegava snapshots dos últimos 30 dias do streamer inteiro.
      // Agora restringe à janela [vod_created_at .. vod_created_at + duration].
      let vodStartIso: string | null = null;
      let vodEndIso: string | null = null;
      let windowSource: "audit_field" | "twitch_api" | "approximation" = "approximation";

      if ((audit as any).vod_created_at) {
        vodStartIso = new Date((audit as any).vod_created_at).toISOString();
        windowSource = "audit_field";
      }

      if (!vodStartIso) {
        const createdAt = await fetchVodCreatedAt(audit.vod_id);
        if (createdAt) {
          vodStartIso = createdAt;
          windowSource = "twitch_api";
          await sb.from("vod_audits").update({ vod_created_at: createdAt }).eq("id", audit.id);
        }
      }

      if (!vodStartIso) {
        const approximateStart = new Date(Date.now() - audit.vod_duration_seconds * 1000);
        vodStartIso = approximateStart.toISOString();
        windowSource = "approximation";
        console.warn(
          `[fallback] Using approximate VOD start time. Results may be ` +
          `inaccurate if audit was run long after the live ended.`
        );
      }

      const vodStart = new Date(vodStartIso);
      const vodEnd = new Date(vodStart.getTime() + (audit.vod_duration_seconds + 90) * 1000);
      vodEndIso = vodEnd.toISOString();

      console.log(
        `[fallback] VOD window: ${vodStartIso} → ${vodEndIso} ` +
        `(source: ${windowSource}, duration=${audit.vod_duration_seconds}s)`
      );

      const { data: liveSnaps } = await sb
        .from("stream_snapshots")
        .select("game_name, captured_at")
        .eq("streamer_login", audit.streamer_login)
        .eq("is_live", true)
        .eq("source", "live")
        .gte("captured_at", vodStartIso)
        .lte("captured_at", vodEndIso)
        .not("game_name", "is", null);

      console.log(
        `[fallback] Found ${liveSnaps?.length || 0} snapshots in VOD window ` +
        `(streamer=${audit.streamer_login})`
      );

      const maxPossibleSnapshots = Math.ceil(audit.vod_duration_seconds / 15) + 10;
      if ((liveSnaps?.length || 0) > maxPossibleSnapshots) {
        console.warn(
          `[fallback] Anomaly: ${liveSnaps?.length} snapshots found but max ` +
          `possible is ${maxPossibleSnapshots}. Capping at max.`
        );
        liveSnaps?.sort((a, b) =>
          new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime()
        );
        liveSnaps?.splice(maxPossibleSnapshots);
      }

      snapshotsFound = (liveSnaps || []).length;

      if (snapshotsFound > 0) {
        const CASINO_CATEGORIES = new Set(["Virtual Casino", "Slots", "Casino", "Poker"]);
        const SECONDS_PER_SNAPSHOT = 15; // 0.25 min / snapshot

        for (const s of liveSnaps || []) {
          const cat = (s.game_name || "").trim();
          if (!CASINO_CATEGORIES.has(cat)) continue;
          pushDetection(cat, "Twitch Category", 1.0, SECONDS_PER_SNAPSHOT);
        }

        if (byGame.size > 0) dataSource = "stream_snapshots:live";
        else diagnosticLog = `Encontrados ${snapshotsFound} snapshots, mas 0 blocos de gameplay. Erro na função de consolidação (nenhuma categoria de cassino reconhecida).`;
      } else {
        diagnosticLog = `Nenhum snapshot (storyboard ou live) encontrado para @${audit.streamer_login}.`;
      }
    }

    const games = Array.from(byGame.values())
      .map((g) => ({ ...g, status: g.frames === 1 || g.avgConfidence < 0.5 ? "suspect" as const : "confirmed" as const }))
      .sort((a, b) => b.seconds - a.seconds);
    const totalCasinoSeconds = games.reduce((s, g) => s + g.seconds, 0);
    const totalPendingFrames = games.reduce((s, g) => s + g.pendingFrames, 0);
    const vodDuration = audit.vod_duration_seconds || 0;
    const otherSeconds = Math.max(0, vodDuration - totalCasinoSeconds);

    const fmt = (sec: number) => {
      const h = Math.floor(sec / 3600);
      const m = Math.round((sec % 3600) / 60);
      return h > 0 ? `${h}h${m.toString().padStart(2, "0")}m` : `${m}m`;
    };

    const summaryLines = games
      .filter((g) => g.frames >= 2)
      .map((g) => `${fmt(g.seconds)} de ${g.game}${g.provider !== "Unknown" && g.provider !== "Twitch Category" ? ` (${g.provider})` : ""}`)
      .slice(0, 10);

    const sourceNote = dataSource === "stream_snapshots:live"
      ? " (fonte: monitor live — categorias Twitch)"
      : "";

    const summary = games.length === 0
      ? `Auditoria do VOD de "${audit.streamer_login}" (${fmt(vodDuration)}) concluída sem detectar conteúdo de cassino.`
      : `O streamer "${audit.streamer_login}" jogou ${fmt(vodDuration)}, sendo ${fmt(totalCasinoSeconds)} de jogos de cassino e ${fmt(otherSeconds)} de Conteúdo Geral${sourceNote}. Detalhe: ${summaryLines.join(", ")}.`;

    return jsonResponse({
      audit_id,
      vod_id: audit.vod_id,
      streamer_login: audit.streamer_login,
      vod_duration_seconds: vodDuration,
      total_casino_seconds: totalCasinoSeconds,
      total_other_seconds: otherSeconds,
      state_breakdown: stateBreakdown,
      games,
      summary,
      sullygnome: audit.sullygnome_snapshot,
      pending_audits: ((audit.pending_audit_segments as any)?.flagged || []).length,
      audit_status: audit.status,
      error_message: audit.error_message,
      expected_frames: audit.expected_frames,
      data_source: dataSource,
      snapshots_found: snapshotsFound,
      diagnostic_log: diagnosticLog,
      pending_review_frames: totalPendingFrames,
      reconciliation_status: audit.reconciliation_status || "pending",
      reconciliation_notes: audit.reconciliation_notes || null,
      last_checkpoint_at: audit.last_checkpoint_at || null,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACTION: watchdog — find stalled audits and re-invoke them
  // ─────────────────────────────────────────────────────────────────────────
  if (action === "watchdog") {
    const stallThresholdMs = 2 * 60 * 1000; // 2 minutes without checkpoint = stalled
    const cutoff = new Date(Date.now() - stallThresholdMs).toISOString();

    const { data: stalled } = await sb
      .from("vod_audits")
      .select("id, vod_id, last_checkpoint_at, started_at, status")
      .eq("status", "processing")
      .or(`last_checkpoint_at.lt.${cutoff},last_checkpoint_at.is.null`)
      .limit(10);

    const revived: string[] = [];
    for (const a of stalled || []) {
      // Skip very recently started audits (give them >30s to write first checkpoint)
      const startedAt = a.started_at ? new Date(a.started_at).getTime() : 0;
      if (Date.now() - startedAt < 30_000) continue;
      console.log(`[Watcher] watchdog reviving audit ${a.id} (vod ${a.vod_id})`);
      selfInvokeResume(a.id);
      revived.push(a.id);
    }

    return jsonResponse({
      checked: (stalled || []).length,
      revived: revived.length,
      revived_ids: revived,
    });
  }

  return jsonResponse({ error: "Unknown action. Use start | resume | report | watchdog." }, 400);
});

async function finalizeAudit(sb: any, audit: any, flagged: any[]) {
  const totalMin = Math.round((audit.vod_duration_seconds || 0) / 60);

  // SSoT: count from stream_snapshots (storyboard source)
  const { data: snaps } = await sb
    .from("stream_snapshots")
    .select("game_detected, ai_confidence, confidence_score")
    .eq("vod_id", audit.vod_id)
    .eq("source", "storyboard")
    .not("game_detected", "is", null);

  const validRows = (snaps || []);
  const uniqueGames = new Set(validRows.map((r: any) => r.game_detected)).size;

  // ── Reconciliation: detected_seconds vs vod_duration ──────────────────────
  const interval = audit.expected_frames && audit.vod_duration_seconds
    ? Math.max(1, Math.round(audit.vod_duration_seconds / audit.expected_frames))
    : 39;
  const detectedSeconds = validRows.length * interval;
  const vodDuration = audit.vod_duration_seconds || 0;

  let reconciliationStatus = "ok";
  let reconciliationNotes = `${validRows.length} frames × ${interval}s = ${detectedSeconds}s detectados em ${vodDuration}s totais.`;
  if (vodDuration === 0) {
    reconciliationStatus = "mismatch";
    reconciliationNotes = "VOD duration desconhecido — não é possível reconciliar.";
  } else if (detectedSeconds > vodDuration * 1.05) {
    reconciliationStatus = "mismatch";
    reconciliationNotes += " ⚠ Soma de frames excede duração do VOD (>105%).";
  }

  const segments = (audit.pending_audit_segments as any) || {};
  segments.flagged = flagged;
  if (segments.plan) {
    segments.plan = {
      processed_mosaic: segments.plan.processed_mosaic,
      mosaic_count: Array.isArray(segments.plan.mosaics) ? segments.plan.mosaics.length : 0,
      interval: segments.plan.interval,
    };
  }

  await sb.from("vod_audits").update({
    status: flagged.length > 0 ? "needs_review" : "completed",
    progress_phase: "completed",
    progress_current_minute: totalMin,
    progress_games_found: uniqueGames,
    progress_message: `Auditoria concluída: ${uniqueGames} jogos | ${flagged.length} segmentos pendentes | reconcile: ${reconciliationStatus}`,
    completed_at: new Date().toISOString(),
    coverage_percent: 100,
    total_evidences: validRows.length,
    valid_evidences: validRows.length,
    confirmed_blocks: uniqueGames,
    pending_audit_segments: segments as any,
    reconciliation_status: reconciliationStatus,
    reconciliation_notes: reconciliationNotes,
    last_checkpoint_at: new Date().toISOString(),
  }).eq("id", audit.id);

  console.log(`[Watcher ${audit.id}] FINALIZED: ${uniqueGames} games, ${validRows.length} snapshots, ${flagged.length} flagged, reconcile=${reconciliationStatus}`);

  // Auto-sync: populate gameplay_blocks so the Scanner Dashboard picks up the new data
  try {
    await handleWrite(sb, { action: "validate_vod", vod_id: audit.vod_id });
    await handleWrite(sb, { action: "consolidate_vod", vod_id: audit.vod_id });
    await handleWrite(sb, { action: "compute_metrics", vod_id: audit.vod_id, vod_duration_seconds: audit.vod_duration_seconds });
    console.log(`[Watcher ${audit.id}] Auto pipeline sync triggered for vod_id=${audit.vod_id}`);
  } catch (e) {
    console.warn("[Watcher] pipeline sync error:", e);
  }
}
