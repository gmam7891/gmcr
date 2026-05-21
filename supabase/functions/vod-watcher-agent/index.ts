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

const MOSAICS_PER_CHUNK = 8;          // process up to 8 storyboard mosaics per HTTP chunk (was 4 — too thin for medium variant)
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

function gameMatchKey(name: string | null | undefined): string {
  if (!name) return "";
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
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

// ── AI Gateway call with structured backoff ──────────────────────────────────
// Bug #2: dedicated exponential backoff with jitter for 429/402/5xx that
// respects Retry-After header. 402 (quota) is non-retryable and surfaced via
// `quota_exhausted` so callers can pause the audit with needs_review status.
async function callAI(messages: any[]): Promise<{
  items: any[]; ok: boolean; status: number; raw: string;
  quota_exhausted?: boolean; retry_after_seconds?: number;
}> {
  const MAX_ATTEMPTS = 5;
  const BASE_DELAY_MS = 1000;
  const MAX_DELAY_MS = 16000;
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(AI_GATEWAY, {
        method: "POST",
        headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "google/gemini-2.5-flash", messages, max_tokens: 8192 }),
      });
    } catch (e) {
      lastBody = (e as Error).message;
      lastStatus = 0;
      const backoff = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, attempt - 1)) + Math.random() * 500;
      console.warn(`[Watcher] AI network error attempt ${attempt}/${MAX_ATTEMPTS}: ${lastBody}. Retrying in ${Math.round(backoff)}ms`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    if (res.ok) {
      const data = await res.json().catch(() => null);
      const raw = data?.choices?.[0]?.message?.content ?? "[]";
      return { items: parseAIBatch(raw), ok: true, status: 200, raw };
    }

    lastStatus = res.status;
    lastBody = await res.text().catch(() => "");

    // 402: quota exhausted — do NOT retry, signal upstream to stop the audit.
    if (res.status === 402) {
      console.error(`[Watcher] AI gateway quota exhausted (402): ${lastBody.slice(0, 200)}`);
      return { items: [], ok: false, status: 402, raw: lastBody, quota_exhausted: true };
    }

    if (res.status === 429 || res.status >= 500) {
      const retryAfterHeader = res.headers.get("Retry-After");
      const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      const backoff = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.min(MAX_DELAY_MS, retryAfterSec * 1000)
        : Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, attempt - 1)) + Math.random() * 500;
      console.warn(
        `[Watcher] AI ${res.status} attempt ${attempt}/${MAX_ATTEMPTS}` +
        (retryAfterHeader ? ` (Retry-After=${retryAfterHeader}s)` : "") +
        `. Backing off ${Math.round(backoff)}ms. body="${lastBody.slice(0, 120)}"`
      );
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
    }

    // Non-retryable 4xx (other than 402) — return immediately
    return { items: [], ok: false, status: res.status, raw: lastBody };
  }
  console.warn(`[Watcher] AI call exhausted ${MAX_ATTEMPTS} attempts (last status=${lastStatus})`);
  return { items: [], ok: false, status: lastStatus, raw: lastBody };
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
// Sets a `reason` flag we surface upstream (not_found | gql_failed | info_failed | empty).
type StoryboardPlan = {
  mosaics: Array<{ url: string; cols: number; rows: number; tile_w: number; tile_h: number; tiles: Array<{ row: number; col: number; ts: number }> }>;
  interval: number;
  total_tiles: number;
};
type StoryboardResult = { plan: StoryboardPlan | null; reason: "ok" | "not_found" | "gql_failed" | "info_failed" | "empty" };

async function fetchStoryboardPlan(vodId: string): Promise<StoryboardResult> {
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
  if (!gqlBody) return { plan: null, reason: "gql_failed" };
  const infoUrl: string | undefined = gqlBody?.data?.video?.seekPreviewsURL;
  if (!infoUrl) return { plan: null, reason: "not_found" };

  // 2. Fetch the info.json (with retry)
  const variants: any[] = await withRetry("storyboard-info-json", async () => {
    const r = await fetch(infoUrl);
    if (!r.ok) throw new Error(`info ${r.status}`);
    return await r.json();
  }).catch(() => []);
  if (!Array.isArray(variants) || variants.length === 0) return { plan: null, reason: "info_failed" };

  console.log(
    `[storyboard] All variants for VOD ${vodId}: ` +
    variants.map((v: any) => `${v.quality}(${v.count}t,${v.interval}s,${v.width}x${v.height})`).join(", ")
  );

  const byQuality = (q: string) => variants.find((v: any) => String(v.quality).toLowerCase() === q);
  const variant =
    byQuality("medium") ??
    byQuality("high") ??
    variants.reduce((best: any, v: any) => {
      if (!best) return v;
      const bestArea = (best?.width || 0) * (best?.height || 0);
      const vArea = (v?.width || 0) * (v?.height || 0);
      if (vArea > bestArea) return v;
      if (vArea < bestArea) return best;
      return (v?.count || 0) > (best?.count || 0) ? v : best;
    }, null) ??
    variants[variants.length - 1];
  console.log(
    `[storyboard] Selected "${variant.quality}" with ${variant.count} tiles, ` +
    `interval ${variant.interval}s, tile ${variant.width}x${variant.height}.`
  );
  const { count, cols, rows, width, height, interval, images } = variant;
  if (!count || !cols || !rows || !width || !height || !interval || !Array.isArray(images)) {
    return { plan: null, reason: "empty" };
  }

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
        ts: Math.round(g * interval + interval / 2),
      });
    }
    return { url: baseUrl + imgName, cols, rows, tile_w: width, tile_h: height, tiles };
  });

  return { plan: { mosaics, interval, total_tiles: count }, reason: "ok" };
}

// Bug #7: self-invoke must use SERVICE_ROLE for internal authenticated calls
// and we want to log the result so a failed resume doesn't disappear silently.
async function selfInvokeResume(auditId: string) {
  const url = `${SUPABASE_URL}/functions/v1/vod-watcher-agent`;
  const token = SERVICE_KEY || ANON_KEY;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "apikey": token,
      },
      body: JSON.stringify({ action: "resume", audit_id: auditId }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[Watcher] self-invoke resume returned ${res.status}: ${body.slice(0, 200)}`);
    } else {
      console.log(`[Watcher] self-invoke resume queued for audit ${auditId}`);
    }
  } catch (e) {
    console.warn("[Watcher] self-invoke failed:", e);
  }
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

    // Fetch storyboard plan + chapters + VOD created_at in parallel.
    // Bug #3: differentiate `timeout` from `not_found` so the UI/error can
    // explain why we couldn't proceed.
    const TIMEOUT_TOKEN = { __timeout: true } as const;
    const [storyboardOutcome, chapters, vodCreatedAt] = await Promise.all([
      Promise.race([
        fetchStoryboardPlan(vod_id),
        new Promise<typeof TIMEOUT_TOKEN>((resolve) => setTimeout(() => resolve(TIMEOUT_TOKEN), 8000)),
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

    const storyboardTimedOut = storyboardOutcome === TIMEOUT_TOKEN;
    const storyboard = storyboardTimedOut ? null : (storyboardOutcome as StoryboardResult);

    if (storyboardTimedOut || !storyboard?.plan || storyboard.plan.mosaics.length === 0) {
      const reason = storyboardTimedOut ? "timeout" : (storyboard?.reason ?? "not_found");
      const errMap: Record<string, string> = {
        timeout: "Timeout ao buscar storyboards na Twitch (>8s). VOD pode estar com storyboard ainda processando. Tente novamente em alguns minutos.",
        not_found: "Storyboards indisponíveis para este VOD (Twitch não retornou seekPreviewsURL). Tente um VOD mais recente.",
        gql_failed: "Falha ao consultar Twitch GraphQL para storyboards após retries.",
        info_failed: "Twitch retornou um descritor de storyboard inválido (info.json vazio).",
        empty: "Storyboard descritor está sem variantes utilizáveis.",
      };
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
        error_message: errMap[reason] || errMap.not_found,
        progress_phase: "failed",
        progress_message: errMap[reason] || errMap.not_found,
        partial_reason: `storyboard_${reason}`,
        sullygnome_snapshot: {},
        pending_audit_segments: { plan: null, flagged: [{ reason: `storyboard_${reason}` }] } as any,
      };
      const { data: row } = await sb.from("vod_audits").upsert(auditPayload, { onConflict: "vod_id,platform" }).select("id").single();
      return jsonResponse({
        audit_id: row?.id,
        total_frames: 0,
        total_minutes: totalMinutes,
        chapters: chapters?.length ?? 0,
        storyboard_reason: reason,
        message: errMap[reason] || errMap.not_found,
      });
    }

    const plan = storyboard.plan;
    const totalFrames = plan.total_tiles;
    // Bug #3c: VOD recente pode estar com storyboard ainda processando. Em vez
    // de seguir silenciosamente, marcamos partial_reason para que a UI mostre
    // o aviso de baixa precisão.
    const minExpectedTiles = Math.max(20, Math.floor(vod_duration_seconds / 60));
    let partialReason: string | null = null;
    if (totalFrames < minExpectedTiles) {
      partialReason = `low_storyboard_coverage:${totalFrames}/${minExpectedTiles}`;
      console.warn(
        `[storyboard] VOD ${vod_id}: only ${totalFrames} tiles for ${vod_duration_seconds}s VOD. ` +
        `Expected at least ${minExpectedTiles}. Marking audit as partial.`
      );
    }

    // Wipe any stale data for this VOD so re-scans don't accumulate duplicates.
    await Promise.all([
      sb.from("raw_evidences").delete().eq("vod_id", vod_id),
      sb.from("stream_snapshots").delete().eq("vod_id", vod_id).eq("source", "storyboard"),
      sb.from("gameplay_blocks").delete().eq("vod_id", vod_id),
    ]);

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
      partial_reason: partialReason,
      progress_phase: "starting",
      progress_total_minutes: totalMinutes,
      progress_current_minute: 0,
      progress_games_found: 0,
      progress_message: `Plano: ${plan.mosaics.length} mosaicos | ${totalFrames} frames | ${chapters.length} capítulos` + (partialReason ? " ⚠ baixa precisão (storyboard incompleto)" : ""),
      sullygnome_snapshot: {},
      pending_audit_segments: {
        plan: {
          mosaics: plan.mosaics,
          interval: plan.interval,
          chapters,
          vod_title: vod_title || "",
          processed_mosaic: 0,
        },
        flagged: partialReason ? [{ reason: partialReason }] : [],
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

    const vodStartMs = (audit as any).vod_created_at
      ? new Date((audit as any).vod_created_at).getTime()
      : Date.now() - audit.vod_duration_seconds * 1000;

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
      .select("game_name, provider_name, visual_dna, training_status");

    if (libErr) {
      console.warn(`[Watcher ${audit.id}] Failed to load library: ${libErr.message}`);
    }

    const gameLibrary: Array<{
      name: string;
      provider: string;
      keywords: string[];
      trained: boolean;
    }> = (libraryRows || []).map((row: any) => {
      const dna = row.visual_dna || {};
      const provider = normalizeProviderName(
        dna.provider_canonical || row.provider_name || "Unknown",
      );
      const keywords = Array.isArray(dna.detection_keywords)
        ? dna.detection_keywords.slice(0, 6).map((k: any) => String(k))
        : [];
      return {
        name: row.game_name,
        provider,
        keywords,
        trained: row.training_status === "trained" && keywords.length > 0,
      };
    });

    const trainedGames = gameLibrary.filter((g) => g.trained);
    const nameOnlyGames = gameLibrary.filter((g) => !g.trained);

    console.log(
      `[Watcher ${audit.id}] Library loaded: ${gameLibrary.length} total ` +
      `(${trainedGames.length} trained w/ keywords, ${nameOnlyGames.length} name-only), ` +
      `providers=${new Set(gameLibrary.map((g) => g.provider)).size}`,
    );

    // Trained section (with keywords): "GameName|Provider|kw1,kw2,kw3,kw4"
    const trainedContext = trainedGames
      .map((g) => `${g.name}|${g.provider}|${g.keywords.slice(0, 4).join(",")}`)
      .join("\n");

    // Name-only section: just "GameName|Provider", no keywords. Helps the AI
    // know these games EXIST without leading it to over-confident matches.
    const nameOnlyContext = nameOnlyGames
      .map((g) => `${g.name}|${g.provider}`)
      .join("\n");

    const libraryContext = trainedContext +
      (nameOnlyContext
        ? `\n\n═══════════════════════════════════════════════════════════════
OUTROS JOGOS CATALOGADOS (apenas nome — confirme visualmente antes de retornar):
═══════════════════════════════════════════════════════════════
${nameOnlyContext}`
        : "");

    console.log(
      `[Watcher ${audit.id}] Library context: ${libraryContext.length} chars, ` +
      `~${Math.round(libraryContext.length / 4)} tokens`,
    );

    const mosaicPrompt = buildMosaicPrompt(libraryContext);

    // Index para validação rápida (case-insensitive) por nome do jogo.
    // Inclui TODOS os jogos catalogados (trained + name-only) para que o
    // matching contra a biblioteca aceite também jogos sem visual_dna.
    const libraryIndex = new Map<string, { name: string; provider: string }>();
    for (const g of gameLibrary) {
      libraryIndex.set(gameMatchKey(g.name), { name: g.name, provider: g.provider });
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
          { role: "system", content: mosaicPrompt + "\n\nESTE MOSAICO COBRE PERÍODO CONFIRMADO COMO CASSINO. Identifique TODOS os tiles que tenham slot/cassino visível, mesmo se a thumb for baixa resolução." },
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
      const rejectedRows: any[] = [];
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

        // ── Validação contra game_visual_library (anti-alucinação) ──────────
        // Confidence floor: a library match alone is NOT enough — Gemini
        // routinely defaults to popular library entries (Big Bass Bonanza,
        // Candy Blitz, Mochimon, Inca Queen, etc.) whenever it sees a slot
        // it can't actually read. Require ≥ 0.75 confidence for the match
        // to count, otherwise treat it as a guess and discard.
        const LIBRARY_MATCH_CONF_FLOOR = 0.65;
        const UNKNOWN_GAME_CONF_FLOOR = 0.55;
        const isUnknownGame = !!det.is_unknown_game;
        let validatedGameName: string | null = null;
        let validatedProvider: string | null = null;
        let libraryMatched = false;

        if (det.game_name && (screenState === "gameplay" || screenState === "loading")) {
          const rawGame = String(det.game_name).trim();
          const match = libraryIndex.get(gameMatchKey(rawGame));

          if (match && conf >= LIBRARY_MATCH_CONF_FLOOR) {
            // Match canônico na biblioteca COM confiança suficiente
            validatedGameName = match.name;
            validatedProvider = match.provider;
            libraryMatched = true;
          } else if (match) {
            // Está na biblioteca mas confiança baixa → provavelmente chute
            console.warn(
              `[Watcher ${audit.id}] Discarding low-confidence library guess: "${rawGame}" ` +
              `(conf=${conf.toFixed(2)} < ${LIBRARY_MATCH_CONF_FLOOR}). evidence="${det.evidence || ""}"`,
            );
            rejectedRows.push({
              vod_id: audit.vod_id,
              audit_id: audit.id,
              streamer_login: audit.streamer_login,
              timestamp_seconds: tile.ts,
              proposed_game: rawGame,
              proposed_provider: match.provider,
              confidence: conf,
              reason: "low_confidence_library_match",
              evidence: det.evidence || null,
              raw_payload: { screen_state: screenState, det },
            });
          } else if (isUnknownGame && conf >= UNKNOWN_GAME_CONF_FLOOR) {
            // Fora da biblioteca, mas Gemini admitiu — aceita com flag
            validatedGameName = rawGame.slice(0, 80);
            validatedProvider = det.provider_name
              ? normalizeProviderName(String(det.provider_name).trim().slice(0, 50))
              : null;
          } else {
            // Tentou retornar jogo fora da biblioteca SEM admitir incerteza → alucinação
            console.warn(
              `[Watcher ${audit.id}] Discarding hallucinated game: "${rawGame}" ` +
              `(not in library, is_unknown_game=${isUnknownGame}, conf=${conf.toFixed(2)})`,
            );
            rejectedRows.push({
              vod_id: audit.vod_id,
              audit_id: audit.id,
              streamer_login: audit.streamer_login,
              timestamp_seconds: tile.ts,
              proposed_game: rawGame,
              proposed_provider: det.provider_name || null,
              confidence: conf,
              reason: isUnknownGame ? "unknown_game_low_confidence" : "hallucinated_outside_library",
              evidence: det.evidence || null,
              raw_payload: { screen_state: screenState, det },
            });
          }
        }

        const gameName = validatedGameName;
        const providerName = validatedProvider;

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
          is_unknown_game: isUnknownGame,
          library_matched: libraryMatched,
        };


        snapshotRows.push({
          streamer_login: audit.streamer_login,
          vod_id: audit.vod_id,
          source: "storyboard",
          captured_at: new Date(vodStartMs + tile.ts * 1000).toISOString(),
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
      // Bug #1: dedup snapshotRows/rawEvidenceRows by chave única ANTES de
      // inserir. Mosaicos sobrepostos geram tiles com mesmo (ts, game).
      // Mantém a entrada com maior confiança.
      const dedupByKey = <T extends { timestamp_seconds?: number; game_detected?: string | null; confidence_score?: number; ai_confidence?: number }>(
        rows: T[], includeGame: boolean,
      ): T[] => {
        const m = new Map<string, T>();
        for (const r of rows) {
          const ts = Number(r.timestamp_seconds);
          if (!Number.isFinite(ts)) continue;
          const key = includeGame ? `${ts}|${String(r.game_detected || "").toLowerCase()}` : String(ts);
          const ex = m.get(key);
          if (!ex) { m.set(key, r); continue; }
          const exConf = Number((ex as any).ai_confidence ?? ex.confidence_score ?? 0);
          const rConf = Number((r as any).ai_confidence ?? r.confidence_score ?? 0);
          if (rConf > exConf) m.set(key, r);
        }
        return Array.from(m.values());
      };
      const dedupSnaps = dedupByKey(snapshotRows, true);
      const dedupEvs = dedupByKey(rawEvidenceRows, false);

      if (dedupSnaps.length > 0) {
        dedupSnaps.sort((a, b) => (a.timestamp_seconds ?? 0) - (b.timestamp_seconds ?? 0));
        dedupEvs.sort((a, b) => (a.timestamp_seconds ?? 0) - (b.timestamp_seconds ?? 0));
        // Use upsert tolerante ao índice único parcial (migration nova).
        const { error: snapErr } = await sb.from("stream_snapshots")
          .upsert(dedupSnaps, { onConflict: "vod_id,timestamp_seconds,game_detected", ignoreDuplicates: true });
        const { error: rawErr } = await sb.from("raw_evidences")
          .upsert(dedupEvs, { onConflict: "vod_id,timestamp_seconds", ignoreDuplicates: true });

        if (snapErr || rawErr) {
          console.error(
            `[Watcher ${audit.id}] bulk upsert failure on mosaic ${mIdx}: ` +
            `snapshot=${snapErr?.message || "ok"} raw=${rawErr?.message || "ok"} ` +
            `(rows=${dedupSnaps.length}). Falling back to per-row.`,
          );
          // Bug #6: fallback linha-a-linha p/ identificar a linha problemática.
          let okSnap = 0, badSnap = 0; const badSnapSamples: any[] = [];
          for (const row of dedupSnaps) {
            const { error: e } = await sb.from("stream_snapshots").upsert(row, { onConflict: "vod_id,timestamp_seconds,game_detected", ignoreDuplicates: true });
            if (e) {
              badSnap++;
              if (badSnapSamples.length < 3) badSnapSamples.push({ ts: row.timestamp_seconds, game: row.game_detected, err: e.message });
            } else okSnap++;
          }
          let okEv = 0, badEv = 0; const badEvSamples: any[] = [];
          for (const row of dedupEvs) {
            const { error: e } = await sb.from("raw_evidences").upsert(row, { onConflict: "vod_id,timestamp_seconds", ignoreDuplicates: true });
            if (e) {
              badEv++;
              if (badEvSamples.length < 3) badEvSamples.push({ ts: row.timestamp_seconds, err: e.message });
            } else okEv++;
          }
          flagged.push({
            mosaic_index: mIdx,
            mosaic_url: mosaic.url,
            ts_window: [firstTs, lastTs],
            reason: "insert_failed_partial",
            snapshot_error: snapErr?.message || null,
            raw_evidence_error: rawErr?.message || null,
            per_row_recovery: { okSnap, badSnap, okEv, badEv, badSnapSamples, badEvSamples },
          });
          totalDetectionsThisChunk += okSnap;
          framesSinceCheckpoint += okSnap;
        } else {
          totalDetectionsThisChunk += dedupSnaps.length;
          framesSinceCheckpoint += dedupSnaps.length;
        }
      }

      // Bug #10: persistir candidatos descartados para revisão humana.
      if (rejectedRows.length > 0) {
        const { error: rejErr } = await sb.from("rejected_detections").insert(rejectedRows);
        if (rejErr) console.warn(`[Watcher ${audit.id}] rejected_detections insert failed: ${rejErr.message}`);
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
    const { data: rawStoryboardSnaps } = await sb
      .from("stream_snapshots")
      .select("game_detected, provider_detected, confidence_score, ai_confidence, timestamp_seconds, is_ai_verified, extra_metadata, ai_evidence")
      .eq("vod_id", audit.vod_id)
      .eq("source", "storyboard")
      .not("game_detected", "is", null);

    const interval =
      audit.expected_frames && audit.vod_duration_seconds
        ? Math.max(1, Math.round(audit.vod_duration_seconds / audit.expected_frames))
        : 39;

    // =================================================================
    // DEDUP POR (TIMESTAMP, GAME) — keeps different games at the same
    // second (PIP, scene transition) while still collapsing duplicate
    // rows for the same game from overlapping mosaics.
    // =================================================================
    const snapDedupMap = new Map<string, any>();
    let snapDuplicatesFound = 0;
    for (const snap of (rawStoryboardSnaps || [])) {
      const ts = Number(snap.timestamp_seconds);
      if (!Number.isFinite(ts)) continue;
      const gameKey = String(snap.game_detected || "").toLowerCase();
      const key = `${ts}|${gameKey}`;
      const existing = snapDedupMap.get(key);
      if (!existing) {
        snapDedupMap.set(key, snap);
      } else {
        snapDuplicatesFound++;
        const existingConf = Number(existing.ai_confidence ?? existing.confidence_score ?? 0);
        const newConf = Number(snap.ai_confidence ?? snap.confidence_score ?? 0);
        if (newConf > existingConf) snapDedupMap.set(key, snap);
      }
    }
    const storyboardSnaps = Array.from(snapDedupMap.values());
    console.log(
      `[report] VOD ${audit.vod_id}: dedup snapshots ` +
      `${rawStoryboardSnaps?.length || 0} → ${storyboardSnaps.length} ` +
      `(${snapDuplicatesFound} duplicates removed)`
    );

    const { data: rawEvidences } = await sb.from("raw_evidences")
      .select("screen_state, timestamp_seconds, confidence_score")
      .eq("vod_id", audit.vod_id);

    // Dedup evidences by timestamp (same bug pattern: 234 rows for ~158 unique ts)
    const evDedupMap = new Map<number, any>();
    let evDuplicatesFound = 0;
    for (const ev of (rawEvidences || [])) {
      const ts = Number(ev.timestamp_seconds);
      if (!Number.isFinite(ts)) continue;
      const existing = evDedupMap.get(ts);
      if (!existing) {
        evDedupMap.set(ts, ev);
      } else {
        evDuplicatesFound++;
        const existingConf = Number(existing.confidence_score || 0);
        const newConf = Number(ev.confidence_score || 0);
        if (newConf > existingConf) evDedupMap.set(ts, ev);
      }
    }
    const allEvidences = Array.from(evDedupMap.values());
    console.log(
      `[report] VOD ${audit.vod_id}: dedup evidences ` +
      `${rawEvidences?.length || 0} → ${allEvidences.length} ` +
      `(${evDuplicatesFound} duplicates removed)`
    );

    const stateBreakdown = {
      gameplay_seconds: 0,
      lobby_seconds: 0,
      loading_seconds: 0,
      other_seconds: 0,
    };
    for (const ev of allEvidences) {
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

    if (byGame.size === 0) {
      diagnosticLog =
        `Nenhuma detecção visual de cassino no VOD de @${audit.streamer_login}. ` +
        `Storyboards retornaram 0 evidências de gameplay/loading. ` +
        `Categorias da Twitch não são tratadas como detecção — apenas a análise visual conta.`;
    }

    // Stricter confirmation: a single frame OR avg confidence < 0.7 means
    // the AI didn't really see the game, just guessed once. Anything below
    // that bar is "suspect" and excluded from the headline totals so the
    // dashboard doesn't show inflated detections of games the streamer
    // never actually played.
    const games = Array.from(byGame.values())
      .map((g) => ({
        ...g,
        status: (g.frames < 2 || g.avgConfidence < 0.7)
          ? "suspect" as const
          : "confirmed" as const,
      }))
      .sort((a, b) => b.seconds - a.seconds);
    const confirmedGames = games.filter((g) => g.status === "confirmed");
    // Headline totals only count CONFIRMED detections — suspects still show
    // in the per-game list (with the suspect badge) for human review.
    const totalCasinoSeconds = confirmedGames.reduce((s, g) => s + g.seconds, 0);
    const totalPendingFrames = games.reduce((s, g) => s + g.pendingFrames, 0);
    const vodDuration = audit.vod_duration_seconds || 0;
    const otherSeconds = Math.max(0, vodDuration - totalCasinoSeconds);

    const fmt = (sec: number) => {
      const h = Math.floor(sec / 3600);
      const m = Math.round((sec % 3600) / 60);
      return h > 0 ? `${h}h${m.toString().padStart(2, "0")}m` : `${m}m`;
    };

    const summaryLines = confirmedGames
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
      partial_reason: (audit as any).partial_reason || null,
      status: audit.status,
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

  // Bug #4: audit com 0 frames NÃO pode ficar "ok". Marca needs_review/mismatch.
  let reconciliationStatus: "ok" | "mismatch" | "needs_review" = "ok";
  let reconciliationNotes = `${validRows.length} frames × ${interval}s = ${detectedSeconds}s detectados em ${vodDuration}s totais.`;
  if (vodDuration === 0) {
    reconciliationStatus = "mismatch";
    reconciliationNotes = "VOD duration desconhecido — não é possível reconciliar.";
  } else if (validRows.length === 0) {
    reconciliationStatus = "needs_review";
    reconciliationNotes += " ⚠ Nenhum frame de cassino detectado — revisar manualmente.";
  } else if (detectedSeconds < vodDuration * 0.05) {
    reconciliationStatus = "needs_review";
    reconciliationNotes += ` ⚠ Detecção <5% da duração (${detectedSeconds}s de ${vodDuration}s) — revisar.`;
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
      chapters: Array.isArray(segments.plan.chapters) ? segments.plan.chapters : [],
      vod_title: segments.plan.vod_title,
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
