// VOD Audit Pro pipeline — direct Deno port of the VOD Audit Pro reference app.
// Uses storyboard mosaics + Lovable AI Gateway (Gemini) with reference thumbs
// pulled from game_visual_library. Persists queue on vod_audits.pending_frames
// and claims sprites atomically via claim_next_sprite / apply_chunk_result RPCs.
//
// Actions: start | process_chunk | report

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GQL_URL = "https://gql.twitch.tv/gql";
const GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Strategy = "balanced" | "title_first" | "hud_first" | "aggressive_casino";
const STRATEGY_INSTRUCTIONS: Record<Strategy, string> = {
  balanced:
    "Balance visual theme (symbols, palette) and HUD text/logos. Prefer exact title match when the theme is clear; use OTHER_CASINO for casino-like frames you cannot match.",
  title_first:
    "Prioritize matching an exact title from the closed list using theme, symbols and reference images. Only use OTHER_CASINO when you are confident it's a casino frame but no title fits.",
  hud_first:
    "Prioritize HUD cues (bet/balance/spin buttons, game logos in corners, provider watermarks) over theme. Match a title only when the HUD/logo clearly confirms it; otherwise use OTHER_CASINO.",
  aggressive_casino:
    "Bias strongly toward OTHER_CASINO whenever ANY slot/casino UI is visible (reels, spin/bet HUD, cabinet, wheel). Only return UNIDENTIFIED for obviously non-casino frames (chat, webcam, desktop, other game).",
};

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function pickModelFor(strategy: Strategy, highPrecision: boolean): string {
  if (highPrecision || strategy === "aggressive_casino") return "google/gemini-2.5-pro";
  return "google/gemini-2.5-flash";
}

// ─── Twitch GQL / storyboard ────────────────────────────────────────────────
async function gql(op: string, query: string, variables: Record<string, unknown>) {
  const r = await fetch(GQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Client-ID": GQL_CLIENT_ID },
    body: JSON.stringify({ operationName: op, query, variables }),
  });
  if (!r.ok) throw new Error(`Twitch GQL ${op} ${r.status}: ${await r.text()}`);
  const j = await r.json();
  if (j.errors) throw new Error(`Twitch GQL ${op} errors: ${JSON.stringify(j.errors)}`);
  return j.data;
}

async function fetchSeekPreviewsURL(vodId: string): Promise<string | null> {
  const d = await gql(
    "VideoSeekPreviews",
    `query VideoSeekPreviews($id: ID!) { video(id: $id) { seekPreviewsURL } }`,
    { id: vodId },
  );
  return d?.video?.seekPreviewsURL ?? null;
}

async function fetchChapters(vodId: string): Promise<any[]> {
  try {
    const d = await gql(
      "VideoChapterMarkers",
      `query VideoChapterMarkers($id: ID!) {
        video(id: $id) {
          moments(momentRequestType: VIDEO_CHAPTER_MARKERS, first: 100) {
            edges { node {
              positionMilliseconds durationMilliseconds description
              details { __typename ... on GameChangeMomentDetails { game { displayName } } }
            }}
          }
        }
      }`,
      { id: vodId },
    );
    const edges = d?.video?.moments?.edges ?? [];
    return edges.map((e: any) => ({
      positionSeconds: Math.round(e.node.positionMilliseconds / 1000),
      durationSeconds: Math.round(e.node.durationMilliseconds / 1000),
      game: e.node.details?.game?.displayName ?? e.node.description ?? "",
    }));
  } catch { return []; }
}

interface Sprite {
  url: string; rows: number; cols: number; intervalSec: number;
  tiles: { ts: number; row: number; col: number }[];
}

async function fetchStoryboards(vodId: string, lengthSec: number): Promise<{ variantLabel: string; sprites: Sprite[] } | null> {
  const seekUrl = await fetchSeekPreviewsURL(vodId);
  if (!seekUrl) return null;
  const r = await fetch(seekUrl);
  if (!r.ok) return null;
  const raw = await r.json();
  const variants: any[] = Array.isArray(raw) ? raw : (raw.images ?? raw.sizes ?? []);
  if (!variants.length) return null;

  // Pick strictly max-area variant (Audit Pro rule).
  const chosen = variants.reduce((best: any, v: any) => {
    const area  = (v.width ?? 0) * (v.height ?? 0);
    const bArea = (best.width ?? 0) * (best.height ?? 0);
    return area > bArea ? v : best;
  }, variants[0]);

  const cols = chosen.cols ?? 5;
  const rows = chosen.rows ?? 5;
  const interval = chosen.interval ?? 30;
  const tileW = chosen.width ?? 160;
  const tileH = chosen.height ?? 90;
  const urls: string[] = chosen.images ?? chosen.urls ?? [];
  if (!urls.length) return null;

  const base = seekUrl.substring(0, seekUrl.lastIndexOf("/") + 1);
  const resolved = urls.map((u) => (/^https?:\/\//.test(u) ? u : base + u));
  const perSprite = rows * cols;

  const sprites: Sprite[] = resolved.map((url, si) => {
    const tiles: { ts: number; row: number; col: number }[] = [];
    for (let i = 0; i < perSprite; i++) {
      const g = si * perSprite + i;
      const ts = g * interval;
      if (ts >= lengthSec) break;
      tiles.push({ ts, row: Math.floor(i / cols), col: i % cols });
    }
    return { url, rows, cols, intervalSec: interval, tiles };
  }).filter((s) => s.tiles.length > 0);

  return {
    variantLabel: `${tileW}x${tileH} @ ${interval}s/tile (${cols}x${rows})`,
    sprites,
  };
}

// ─── Reference thumbs & sprite bytes ────────────────────────────────────────
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    const bytes = new Uint8Array(ab);
    let mime = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!mime || mime === "application/octet-stream") {
      if (bytes[0] === 0xff && bytes[1] === 0xd8) mime = "image/jpeg";
      else if (bytes[0] === 0x89 && bytes[1] === 0x50) mime = "image/png";
      else mime = "image/jpeg";
    }
    // base64-encode
    let b64 = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      b64 += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return `data:${mime};base64,${btoa(b64)}`;
  } catch { return null; }
}

// ─── Gemini call with retry/backoff (Audit Pro policy) ──────────────────────
const RETRYABLE = new Set([429, 500, 502, 503, 504, 524]);

async function detectSprite(params: {
  model: string;
  provider: string;
  strategy: Strategy;
  games: Array<{ title: string; keywords: string; palette: string; hud: string; refUrls: string[] }>;
  sprite: Sprite;
  spriteDataUrl: string;
}): Promise<{ frames: Array<{ timestamp_sec: number; detection: string; confidence: number; reason?: string }> }> {
  const tileList = params.sprite.tiles.map((t) => `- (row ${t.row}, col ${t.col}) → timestamp_sec=${t.ts}`).join("\n");
  const gameList = params.games.map((g, i) => [
    `${i + 1}. ${g.title}`,
    `   keywords: ${g.keywords || "(none)"}`,
    `   palette: ${g.palette || "(none)"}`,
    `   HUD: ${g.hud || "(none)"}`,
    `   references: ${g.refUrls.length > 0 ? `${g.refUrls.length} images labeled "REFERENCE — ${g.title} #N"` : "(none)"}`,
  ].join("\n")).join("\n\n");

  const prompt = `You are auditing storyboard frames from a Twitch VOD to find casino/slot gameplay from the provider "${params.provider}".

The attached image is a sprite of ${params.sprite.rows} rows × ${params.sprite.cols} columns of tiles in row-major reading order. Analyze ONLY these tiles:
${tileList}

Closed list of ${params.provider} games:

${gameList}

STRATEGY (${params.strategy}): ${STRATEGY_INSTRUCTIONS[params.strategy]}

Classification rules per tile, in order:
1. If ANY casino/slot UI is visible (reels, spin/bet HUD, cabinet, roulette, blackjack table, plinko, crash, mines) the tile IS casino — you MUST NOT return UNIDENTIFIED.
2. If casino, match to the closed list using theme/symbols/palette/HUD. Return the EXACT title as written.
3. If casino but no match, return exactly "OTHER_CASINO".
4. Only UNIDENTIFIED when clearly NOT casino (chat, webcam, desktop, other game like LoL, black frame).
5. Never invent titles. Strict JSON only, no markdown.

Output:
{"frames":[{"timestamp_sec":<int>,"detection":"<title | OTHER_CASINO | UNIDENTIFIED>","confidence":<0..1>,"reason":"<short reason for UNIDENTIFIED>"}]}`;

  const refBlocks: Array<any> = [];
  for (const g of params.games) {
    g.refUrls.forEach((url, i) => {
      refBlocks.push({ type: "text", text: `REFERENCE — ${g.title} #${i + 1}` });
      refBlocks.push({ type: "image_url", image_url: { url } });
    });
  }

  const doCall = async () => {
    const r = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...refBlocks,
            { type: "text", text: "Now analyze the storyboard sprite below and return the JSON:" },
            { type: "image_url", image_url: { url: params.spriteDataUrl } },
          ],
        }],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content ?? "";
    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    return JSON.parse(clean);
  };

  const MAX = 5;
  let last: unknown = null;
  for (let i = 0; i < MAX; i++) {
    try {
      const parsed = await doCall();
      if (!Array.isArray(parsed?.frames)) throw new Error("no frames[]");
      return parsed;
    } catch (e: any) {
      last = e;
      const m = String(e.message ?? e).match(/gemini (\d{3})/);
      const status = m ? Number(m[1]) : null;
      if (status !== null && !RETRYABLE.has(status)) break;
      if (i === MAX - 1) break;
      const base = 1000 * Math.pow(2, i);
      const jitter = base * (Math.random() * 0.6 - 0.3);
      await new Promise((r) => setTimeout(r, Math.max(250, base + jitter)));
    }
  }
  console.error("[AuditPro] gemini retries exhausted:", last);
  return {
    frames: params.sprite.tiles.map((t) => ({
      timestamp_sec: t.ts,
      detection: "UNIDENTIFIED",
      confidence: 0,
      reason: `ai gateway failed: ${String((last as any)?.message ?? last).slice(0, 160)}`,
    })),
  };
}

// ─── Self-invoke helper ──────────────────────────────────────────────────────
function selfInvoke(auditId: string) {
  EdgeRuntime.waitUntil((async () => {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/vod-audit-pro`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ action: "process_chunk", audit_id: auditId }),
      });
    } catch (e) { console.warn("[AuditPro] self-invoke failed:", e); }
  })());
}

// ─── Main handler ───────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const action = body.action;

  try {
    // ── START ─────────────────────────────────────────────────────────────
    if (action === "start") {
      const {
        vod_id, streamer_login, vod_duration_seconds, vod_title,
        provider = "iGaming", strategy = "balanced", high_precision = false,
      } = body;
      if (!vod_id || !streamer_login || !vod_duration_seconds) {
        return jsonResp({ error: "vod_id, streamer_login, vod_duration_seconds required" }, 400);
      }

      const [storyboards, chapters] = await Promise.all([
        fetchStoryboards(String(vod_id), Number(vod_duration_seconds)),
        fetchChapters(String(vod_id)),
      ]);

      if (!storyboards || storyboards.sprites.length === 0) {
        return jsonResp({ error: "Storyboards indisponíveis para este VOD." }, 400);
      }

      const totalFrames = storyboards.sprites.reduce((n, s) => n + s.tiles.length, 0);
      const initialDiagnostics = {
        manifest_variant: storyboards.variantLabel,
        manifest_sprites: storyboards.sprites.length,
        manifest_frames: totalFrames,
        sprites_downloaded: 0,
        sprites_failed: 0,
        frames_detected: 0,
        frames_unidentified: 0,
        frames_other_casino: 0,
        frames_low_confidence: 0,
        unidentified_reasons: {},
        missing_reference_thumbs: [],
        provider,
        strategy,
        high_precision: !!high_precision,
        model: pickModelFor(strategy as Strategy, !!high_precision),
      };

      // Wipe stale rows for this vod so a re-run is clean.
      await Promise.all([
        sb.from("raw_evidences").delete().eq("vod_id", vod_id),
      ]);

      const payload = {
        vod_id: String(vod_id),
        streamer_login,
        platform: "twitch",
        status: "processing" as const,
        vod_duration_seconds: Math.round(vod_duration_seconds),
        expected_frames: totalFrames,
        processed_frames: 0,
        total_frames: totalFrames,
        started_at: new Date().toISOString(),
        completed_at: null,
        error_message: null,
        progress_phase: "starting",
        progress_message: `Audit Pro: ${storyboards.sprites.length} sprites | ${totalFrames} frames | estratégia ${strategy}`,
        storyboard_variant: storyboards.variantLabel,
        detection_strategy: strategy,
        diagnostics: initialDiagnostics,
        pending_frames: storyboards.sprites,
        sullygnome_snapshot: {},
        pending_audit_segments: { plan: { chapters, vod_title: vod_title ?? "", provider }, flagged: [] },
      };

      const { data: row, error: upErr } = await sb
        .from("vod_audits")
        .upsert(payload, { onConflict: "vod_id,platform" })
        .select("id")
        .single();
      if (upErr || !row) return jsonResp({ error: upErr?.message ?? "upsert failed" }, 500);

      selfInvoke(row.id);
      return jsonResp({
        audit_id: row.id,
        total_frames: totalFrames,
        total_sprites: storyboards.sprites.length,
        variant: storyboards.variantLabel,
        message: "Audit Pro iniciado — feche a página, ele continua processando.",
      });
    }

    // ── PROCESS CHUNK ─────────────────────────────────────────────────────
    if (action === "process_chunk") {
      const { audit_id } = body;
      if (!audit_id) return jsonResp({ error: "audit_id required" }, 400);

      const { data: audit } = await sb
        .from("vod_audits")
        .select("id, vod_id, status, detection_strategy, diagnostics, pending_audit_segments, total_frames")
        .eq("id", audit_id)
        .single();
      if (!audit) return jsonResp({ error: "audit not found" }, 404);
      if (audit.status !== "processing") return jsonResp({ ok: true, status: audit.status });

      const { data: sprite, error: claimErr } = await sb.rpc("claim_next_sprite", { _audit_id: audit_id });
      if (claimErr) return jsonResp({ error: claimErr.message }, 500);
      if (!sprite) {
        // queue empty — finalize
        await sb.from("vod_audits").update({
          status: "completed",
          completed_at: new Date().toISOString(),
          progress_phase: "done",
          progress_message: "Audit Pro concluído.",
        }).eq("id", audit_id);
        return jsonResp({ ok: true, status: "completed" });
      }

      const diag = (audit.diagnostics ?? {}) as any;
      const provider: string = diag.provider ?? "iGaming";
      const strategy: Strategy = (audit.detection_strategy as Strategy) ?? "balanced";
      const model: string = diag.model ?? pickModelFor(strategy, !!diag.high_precision);

      // Load games from library, filter by provider if not iGaming/generic.
      const { data: gamesRaw } = await sb
        .from("game_visual_library")
        .select("game_name, provider_name, provider_slug, agent_keywords, agent_visual_markers, thumbnails, visual_dna, training_status")
        .limit(80);
      const filtered = (gamesRaw ?? []).filter((g: any) =>
        provider === "iGaming" || provider === "any" ||
        (g.provider_name?.toLowerCase() === provider.toLowerCase()) ||
        (g.provider_slug?.toLowerCase() === provider.toLowerCase()),
      );

      // Cap to 40 games / 3 refs each (prompt token control).
      const games = await Promise.all(filtered.slice(0, 40).map(async (g: any) => {
        const thumbs: any[] = Array.isArray(g.thumbnails) ? g.thumbnails.slice(0, 3) : [];
        const refUrls: string[] = [];
        const missing: string[] = [];
        for (const t of thumbs) {
          if (!t?.storage_path) continue;
          const pub = `${SUPABASE_URL}/storage/v1/object/public/game-thumbnails/${t.storage_path}`;
          const durl = await fetchAsDataUrl(pub);
          if (durl) refUrls.push(durl); else missing.push(t.storage_path);
        }
        const dna = g.visual_dna ?? {};
        return {
          title: g.game_name,
          keywords: (g.agent_keywords ?? dna.detection_keywords ?? []).slice(0, 6).join(", "),
          palette: dna.color_palette ?? "",
          hud: dna.hud_description ?? "",
          refUrls,
          _missing: missing,
        };
      }));

      const missingThumbs = games.flatMap((g) => g._missing);

      // Download sprite as data URL.
      const spriteDataUrl = await fetchAsDataUrl(sprite.url);
      if (!spriteDataUrl) {
        await sb.rpc("apply_chunk_result", {
          _audit_id: audit_id,
          _delta: { sprites_failed: 1, frames_unidentified: sprite.tiles.length, unidentified_reasons: { "sprite download failed": sprite.tiles.length } },
        });
        selfInvoke(audit_id);
        return jsonResp({ ok: true, status: "processing", note: "sprite download failed" });
      }

      const { frames } = await detectSprite({
        model, provider, strategy,
        games: games.map(({ _missing, ...g }) => g),
        sprite,
        spriteDataUrl,
      });

      // Persist detections into raw_evidences.
      const byTs = new Map(frames.map((f) => [f.timestamp_sec, f]));
      const rows: any[] = [];
      let detected = 0, otherCasino = 0, unidentified = 0, lowConf = 0;
      const reasonBuckets: Record<string, number> = {};

      for (const t of sprite.tiles) {
        const f = byTs.get(t.ts);
        const label = (typeof f?.detection === "string" && f.detection) ? f.detection : "UNIDENTIFIED";
        const conf = typeof f?.confidence === "number" ? Math.max(0, Math.min(1, f.confidence)) : 0;
        const reason = f?.reason ? String(f.reason).slice(0, 200) : (label === "UNIDENTIFIED" ? "no detection" : null);

        if (label === "UNIDENTIFIED") {
          unidentified++;
          const key = (reason ?? "no detection").slice(0, 80);
          reasonBuckets[key] = (reasonBuckets[key] ?? 0) + 1;
        } else if (label === "OTHER_CASINO") {
          otherCasino++;
        } else {
          detected++;
          if (conf < 0.6) lowConf++;
        }

        rows.push({
          vod_id: audit.vod_id,
          timestamp_seconds: t.ts,
          game_detected: label,
          provider_detected: label === "OTHER_CASINO" || label === "UNIDENTIFIED" ? null : provider,
          confidence_score: conf,
          ai_confidence: conf,
          is_ai_verified: true,
          ai_evidence: reason ?? null,
          extra_metadata: {
            source: "audit_pro",
            sprite_url: sprite.url,
            tile_row: t.row,
            tile_col: t.col,
            strategy,
            model,
          },
        });
      }

      if (rows.length > 0) {
        await sb.from("raw_evidences").upsert(rows, { onConflict: "vod_id,timestamp_seconds" });
      }

      const { data: applied } = await sb.rpc("apply_chunk_result", {
        _audit_id: audit_id,
        _delta: {
          sprites_downloaded: 1,
          frames_detected: detected,
          frames_other_casino: otherCasino,
          frames_unidentified: unidentified,
          frames_low_confidence: lowConf,
          unidentified_reasons: reasonBuckets,
          missing_reference_thumbs: missingThumbs,
        },
      });

      const remaining = (applied as any)?.remaining_sprites ?? 0;
      const progress = (applied as any)?.progress ?? 0;

      await sb.from("vod_audits").update({
        processed_frames: (audit.total_frames ?? 0) - remaining * (sprite.tiles.length || 1),
        progress_current_minute: Math.round((progress / 100) * ((audit as any).progress_total_minutes ?? 60)),
        progress_message: `Audit Pro: ${remaining} sprites restantes (${progress}%)`,
      }).eq("id", audit_id);

      if (remaining > 0) {
        selfInvoke(audit_id);
        return jsonResp({ ok: true, status: "processing", remaining, progress });
      }

      await sb.from("vod_audits").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        progress_phase: "done",
        progress_message: "Audit Pro concluído.",
      }).eq("id", audit_id);
      return jsonResp({ ok: true, status: "completed", progress: 100 });
    }

    // ── REPORT ────────────────────────────────────────────────────────────
    if (action === "report") {
      const { audit_id } = body;
      const { data: audit } = await sb.from("vod_audits").select("*").eq("id", audit_id).single();
      if (!audit) return jsonResp({ error: "audit not found" }, 404);
      const { data: evidences } = await sb.from("raw_evidences")
        .select("timestamp_seconds, game_detected, confidence_score, extra_metadata")
        .eq("vod_id", audit.vod_id)
        .order("timestamp_seconds", { ascending: true });
      return jsonResp({ audit, evidences: evidences ?? [] });
    }

    return jsonResp({ error: "Unknown action. Use start | process_chunk | report." }, 400);
  } catch (e: any) {
    console.error("[AuditPro] unhandled:", e);
    return jsonResp({ error: e?.message ?? String(e) }, 500);
  }
});
