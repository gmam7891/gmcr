// vod-scan-worker — processa jobs `vod_process` da fila processing_queue.
// Estratégia (v2): delega ao pipeline maduro `vod-watcher-agent` (action=start),
// que tem detecção visual+OCR+lobby/gameplay, dedup e reconciliação. O worker
// só observa `vod_audits` para refletir progresso/resultado no processing_queue.
// Idempotente, seguro p/ cron.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

const MAX_PARALLEL = 2;
const STALL_AFTER_MIN = 20;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function extractVodId(url: string): string | null {
  const m = url.match(/twitch\.tv\/videos?\/(\d+)/i) || url.match(/\/(\d{8,})(?:\?|$|\/)/);
  return m ? m[1] : null;
}

// "1h30m20s" → 5420
function parseTwitchDuration(s: string): number {
  if (!s) return 0;
  let total = 0;
  const re = /(\d+)([hms])/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const n = parseInt(m[1], 10);
    if (m[2].toLowerCase() === "h") total += n * 3600;
    else if (m[2].toLowerCase() === "m") total += n * 60;
    else total += n;
  }
  return total;
}

async function invokeFn(name: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* ignore */ }
  if (!res.ok) throw new Error(data?.error || text || `${name} error ${res.status}`);
  return data;
}

async function patchJob(id: string, patch: Record<string, unknown>) {
  const { error } = await sb.from("processing_queue").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) console.warn(`[worker] failed to patch job ${id}:`, error.message);
}

async function mergeMetadata(id: string, partial: Record<string, unknown>) {
  const { data } = await sb.from("processing_queue").select("metadata").eq("id", id).maybeSingle();
  const merged = { ...(data?.metadata || {}), ...partial };
  await patchJob(id, { metadata: merged });
}

// ─── Start a pending job ─────────────────────────────────────────────────
async function startJob(job: any) {
  const meta = job.metadata || {};
  const vodUrl: string = meta.vod_url || "";
  const vodId = extractVodId(vodUrl);
  if (!vodId) {
    await patchJob(job.id, {
      status: "failed",
      error_message: "URL inválida: não foi possível extrair vod_id da Twitch.",
      completed_at: new Date().toISOString(),
    });
    return;
  }
  let streamer = job.streamer_login && job.streamer_login !== "unknown" ? job.streamer_login : (meta.streamer_login || "");

  // Busca metadados do VOD na Twitch
  let durationSec = 0;
  let title = "";
  let thumbnail = "";
  try {
    const vodResp = await invokeFn("twitch-api", { action: "get_vod", vod_id: vodId });
    const v = vodResp?.data?.[0];
    if (v) {
      durationSec = parseTwitchDuration(v.duration || "");
      title = v.title || "";
      thumbnail = (v.thumbnail_url || "").replace("%{width}", "1280").replace("%{height}", "720");
      if (!streamer && v.user_login) streamer = v.user_login;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await patchJob(job.id, {
      status: "failed",
      error_message: `Falha ao buscar VOD na Twitch: ${msg}`,
      completed_at: new Date().toISOString(),
    });
    return;
  }

  if (!streamer) {
    await patchJob(job.id, {
      status: "failed",
      error_message: "Streamer não informado e não detectado pela Twitch.",
      completed_at: new Date().toISOString(),
    });
    return;
  }
  if (!durationSec) {
    await patchJob(job.id, {
      status: "failed",
      error_message: "VOD sem duração na Twitch (privado, sub-only ou removido?).",
      completed_at: new Date().toISOString(),
    });
    return;
  }

  await patchJob(job.id, {
    status: "running",
    started_at: new Date().toISOString(),
    attempts: (job.attempts || 0) + 1,
    streamer_login: streamer,
    metadata: {
      ...meta,
      vod_id: vodId,
      streamer_login: streamer,
      vod_title: title,
      vod_duration_seconds: durationSec,
      current_step: "starting",
      progress_percent: 1,
    },
  });

  try {
    const out = await invokeFn("vod-watcher-agent", {
      action: "start",
      vod_id: vodId,
      streamer_login: streamer,
      vod_duration_seconds: durationSec,
      thumbnail_url: thumbnail,
      vod_title: title,
    });
    if (!out?.audit_id) throw new Error("vod-watcher-agent não retornou audit_id");
    await mergeMetadata(job.id, {
      audit_id: out.audit_id,
      total_frames: out.total_frames,
      total_minutes: out.total_minutes,
      current_step: "processing",
      progress_percent: 3,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await patchJob(job.id, {
      status: "failed",
      error_message: `vod-watcher start: ${msg}`,
      completed_at: new Date().toISOString(),
    });
  }
}

// ─── Poll a running job ──────────────────────────────────────────────────
async function pollJob(job: any) {
  const meta = job.metadata || {};
  const auditId: string | undefined = meta.audit_id;
  if (!auditId) {
    await patchJob(job.id, { status: "pending", error_message: "running sem audit_id; requeued" });
    return;
  }

  const { data: audit } = await sb.from("vod_audits").select("*").eq("id", auditId).maybeSingle();
  if (!audit) {
    await patchJob(job.id, {
      status: "failed",
      error_message: "vod_audit desapareceu",
      completed_at: new Date().toISOString(),
    });
    return;
  }

  const expected = audit.expected_frames || 1;
  const processed = audit.processed_frames || 0;
  const pct = Math.max(3, Math.min(99, Math.round((processed / expected) * 100)));

  // status do vod_audits: queued | processing | completed | failed
  if (audit.status === "processing" || audit.status === "queued") {
    // Nudge se o audit parou de atualizar
    const lastUpdated = audit.updated_at ? new Date(audit.updated_at).getTime() : 0;
    const stalledMin = (Date.now() - lastUpdated) / 60000;
    if (stalledMin > 3) {
      try { await invokeFn("vod-watcher-agent", { action: "resume", audit_id: auditId }); } catch (_) {}
    }
    await mergeMetadata(job.id, {
      progress_percent: pct,
      current_step: audit.progress_phase || `frame ${processed}/${expected}`,
      progress_message: audit.progress_message || null,
      games_found: audit.progress_games_found || 0,
    });
    return;
  }

  if (audit.status === "completed") {
    // Busca report consolidado
    let report: any = null;
    try {
      report = await invokeFn("vod-watcher-agent", { action: "report", audit_id: auditId });
    } catch (e) {
      console.warn("[worker] report fetch failed:", e);
    }
    const casinoSeconds = report?.total_casino_seconds ?? 0;
    const vodDuration = report?.vod_duration_seconds ?? audit.vod_duration_seconds ?? 0;
    const casinoPercent = vodDuration > 0 ? (casinoSeconds / vodDuration) * 100 : 0;
    const games = Array.isArray(report?.games) ? report.games : [];

    await mergeMetadata(job.id, {
      progress_percent: 100,
      current_step: "done",
      result: {
        casino_seconds: casinoSeconds,
        casino_percent: Number(casinoPercent.toFixed(2)),
        detections_count: games.length,
        vod_duration_seconds: vodDuration,
        summary: report?.summary || null,
        top_games: games.slice(0, 8).map((g: any) => ({
          game: g.game,
          provider: g.provider,
          seconds: g.seconds,
          status: g.status,
        })),
      },
    });
    await patchJob(job.id, {
      status: "completed",
      completed_at: new Date().toISOString(),
    });
    return;
  }

  if (audit.status === "failed") {
    await patchJob(job.id, {
      status: "failed",
      error_message: audit.error_message || "vod_audit failed",
      completed_at: new Date().toISOString(),
    });
    return;
  }
}

// ─── Tick ────────────────────────────────────────────────────────────────
async function tick() {
  const stallCutoff = new Date(Date.now() - STALL_AFTER_MIN * 60_000).toISOString();
  await sb
    .from("processing_queue")
    .update({ status: "pending", error_message: "stalled; requeued by worker" })
    .eq("job_type", "vod_process")
    .eq("status", "running")
    .lt("updated_at", stallCutoff)
    .is("metadata->>audit_id", null);

  const { data: running } = await sb
    .from("processing_queue")
    .select("*")
    .eq("job_type", "vod_process")
    .eq("status", "running")
    .order("started_at", { ascending: true })
    .limit(MAX_PARALLEL);
  for (const j of running || []) await pollJob(j);

  const slots = Math.max(0, MAX_PARALLEL - (running?.length || 0));
  if (slots > 0) {
    const { data: pending } = await sb
      .from("processing_queue")
      .select("*")
      .eq("job_type", "vod_process")
      .eq("status", "pending")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(slots);
    for (const j of pending || []) await startJob(j);
  }

  return { polled: running?.length || 0, started: slots };
}

const FFMPEG_WORKER_URL = Deno.env.get("FFMPEG_WORKER_URL") || "";
const FFMPEG_WORKER_TOKEN = Deno.env.get("FFMPEG_WORKER_TOKEN") || "";
const TWITCH_GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"; // public Twitch web player client-id

async function proxyFfmpegScan(payload: Record<string, unknown>): Promise<Response> {
  if (!FFMPEG_WORKER_URL) return json({ error: "FFMPEG_WORKER_URL not configured" }, 500);
  const upstream = await fetch(`${FFMPEG_WORKER_URL.replace(/\/$/, "")}/scan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(FFMPEG_WORKER_TOKEN ? { Authorization: `Bearer ${FFMPEG_WORKER_TOKEN}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      ...corsHeaders,
      "Content-Type": upstream.headers.get("Content-Type") || "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

// Resolve Twitch VOD → HLS m3u8 URL (no OAuth needed; uses public web client-id).
async function resolveTwitchHls(vodId: string): Promise<string> {
  const gql = await fetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Client-ID": TWITCH_GQL_CLIENT_ID },
    body: JSON.stringify({
      operationName: "PlaybackAccessToken",
      extensions: { persistedQuery: { version: 1, sha256Hash: "0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712" } },
      variables: { isLive: false, login: "", isVod: true, vodID: vodId, playerType: "site" },
    }),
  });
  if (!gql.ok) throw new Error(`Twitch GQL ${gql.status}`);
  const data = await gql.json();
  const tok = data?.data?.videoPlaybackAccessToken;
  if (!tok?.value || !tok?.signature) throw new Error("Twitch não retornou token de playback (VOD privado ou removido).");
  const params = new URLSearchParams({
    allow_source: "true",
    allow_audio_only: "true",
    allow_spectre: "true",
    player: "twitchweb",
    playlist_include_framerate: "true",
    nauth: tok.value,
    nauthsig: tok.signature,
  });
  const m3u8Url = `https://usher.ttvnw.net/vod/${vodId}.m3u8?${params}`;
  const master = await fetch(m3u8Url);
  if (!master.ok) throw new Error(`Twitch HLS master ${master.status}`);
  const text = await master.text();
  // Pick the first variant playlist URL (worst→best); we scale down anyway via ffmpeg.
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const variant = lines.find((l) => l.startsWith("https://") && l.endsWith(".m3u8"));
  return variant || m3u8Url;
}

// End-to-end ffmpeg fallback scan.
// 1) resolve HLS, 2) stream frames from ffmpeg worker, 3) batch-analyze via twitch-api,
// 4) save evidences, 5) run pipeline, 6) upsert vod_audit.
async function scanVodFfmpeg(body: any): Promise<Response> {
  const vodId = String(body?.vod_id || "").trim();
  const streamer = String(body?.streamer_login || "").trim();
  const durationSec = Number(body?.vod_duration_seconds || 0);
  const title = String(body?.vod_title || "");
  const fps = Number(body?.fps || 1 / 60); // default: 1 frame/min
  if (!vodId || !streamer || !durationSec) return json({ error: "vod_id, streamer_login, vod_duration_seconds required" }, 400);
  if (!FFMPEG_WORKER_URL) return json({ error: "FFMPEG_WORKER_URL not configured" }, 500);

  const auditPayload = {
    vod_id: vodId,
    streamer_login: streamer,
    platform: "twitch",
    status: "processing" as const,
    vod_duration_seconds: Math.round(durationSec),
    expected_frames: Math.max(1, Math.round(durationSec * fps)),
    processed_frames: 0,
    started_at: new Date().toISOString(),
    progress_phase: "ffmpeg_scan",
    progress_message: "Iniciando varredura HD via ffmpeg…",
    partial_reason: "ffmpeg_fallback",
    sullygnome_snapshot: {},
    pending_audit_segments: {} as any,
  };
  const { data: auditRow, error: auditErr } = await sb
    .from("vod_audits")
    .upsert(auditPayload, { onConflict: "vod_id,platform" })
    .select("id")
    .single();
  if (auditErr) return json({ error: `vod_audits upsert: ${auditErr.message}` }, 500);
  const auditId = auditRow.id;

  // Kick off async work; return immediately.
  (async () => {
    try {
      const hls = await resolveTwitchHls(vodId);
      const resp = await fetch(`${FFMPEG_WORKER_URL.replace(/\/$/, "")}/scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(FFMPEG_WORKER_TOKEN ? { Authorization: `Bearer ${FFMPEG_WORKER_TOKEN}` } : {}),
        },
        body: JSON.stringify({ vod_url: hls, fps, width: 640 }),
      });
      if (!resp.ok || !resp.body) throw new Error(`ffmpeg worker ${resp.status}`);

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let carry = "";
      const BATCH = 6;
      let batchUrls: string[] = [];
      let batchTs: number[] = [];
      let processed = 0;
      const runId = `ffmpeg_${vodId}_${Date.now()}`;

      const flush = async () => {
        if (!batchUrls.length) return;
        const analyze = await invokeFn("twitch-api", {
          action: "analyze_vod_frames",
          thumbnail_urls: batchUrls,
          timestamps: batchTs,
          vod_title: title,
        }).catch((e) => { console.warn("[ffmpeg] analyze err:", e); return null; });

        const games = (analyze?.games || []).filter((g: any) => g.category !== "not_game");
        const timeline = (analyze?.gameTimeline || []).filter((s: any) => s.category !== "not_game");
        const evidences: any[] = [];
        for (const g of games) {
          evidences.push({
            vod_id: vodId, streamer_login: streamer, platform: "twitch",
            source_type: "vod", source_id: vodId,
            timestamp_seconds: g.timestampSeconds ?? 0,
            game: g.game, provider: g.provider,
            confidence: g.confidence === "high" ? 0.95 : g.confidence === "medium" ? 0.75 : 0.5,
          });
        }
        for (const s of timeline) {
          evidences.push({
            vod_id: vodId, streamer_login: streamer, platform: "twitch",
            source_type: "vod", source_id: vodId,
            timestamp_seconds: s.startSeconds ?? 0,
            game: s.game, provider: s.provider,
            confidence: 0.85,
          });
        }
        if (evidences.length) {
          await invokeFn("scanner-write", { action: "save_raw_evidences", evidences, run_id: runId }).catch((e) => console.warn("[ffmpeg] save err:", e));
        }
        processed += batchUrls.length;
        await sb.from("vod_audits").update({
          processed_frames: processed,
          progress_current_minute: Math.round((batchTs[batchTs.length - 1] || 0) / 60),
          progress_total_minutes: Math.round(durationSec / 60),
          progress_games_found: (auditRow as any).progress_games_found || 0,
          progress_message: `ffmpeg: ${processed} frames processados`,
          updated_at: new Date().toISOString(),
        }).eq("id", auditId);
        batchUrls = []; batchTs = [];
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        carry += dec.decode(value, { stream: true });
        let nl;
        while ((nl = carry.indexOf("\n")) >= 0) {
          const line = carry.slice(0, nl).trim();
          carry = carry.slice(nl + 1);
          if (!line) continue;
          let ev: any; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.done) continue;
          if (ev.error) { console.warn("[ffmpeg] frame err:", ev.error); continue; }
          if (ev.jpeg_b64) {
            batchUrls.push(`data:image/jpeg;base64,${ev.jpeg_b64}`);
            batchTs.push(Math.round(ev.t || 0));
            if (batchUrls.length >= BATCH) await flush();
          }
        }
      }
      await flush();

      // Consolida + métricas
      await invokeFn("scanner-write", { action: "run_pipeline", vod_id: vodId, streamer_login: streamer, vod_duration_seconds: durationSec }).catch((e) => console.warn("[ffmpeg] pipeline err:", e));

      await sb.from("vod_audits").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        progress_phase: "completed",
        progress_message: `ffmpeg: ${processed} frames analisados`,
        processed_frames: processed,
      }).eq("id", auditId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[ffmpeg fallback] failed:", msg);
      await sb.from("vod_audits").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: `ffmpeg fallback: ${msg}`,
        progress_phase: "failed",
        progress_message: msg,
      }).eq("id", auditId);
    }
  })();

  return json({ ok: true, audit_id: auditId, message: "ffmpeg fallback iniciado em background" });
}

async function pingFfmpegWorker(): Promise<Response> {
  if (!FFMPEG_WORKER_URL) {
    return json({
      ok: false,
      code: "missing_url",
      error: "Secret FFMPEG_WORKER_URL ausente no Lovable Cloud",
    }, 200);
  }
  const url = `${FFMPEG_WORKER_URL.replace(/\/$/, "")}/health`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: FFMPEG_WORKER_TOKEN ? { Authorization: `Bearer ${FFMPEG_WORKER_TOKEN}` } : {},
      signal: ctrl.signal,
    });
    const latency_ms = Date.now() - t0;
    const body = await r.text().catch(() => "");
    if (r.status === 401 || r.status === 403) {
      return json({
        ok: false,
        code: "token_rejected",
        status: r.status,
        latency_ms,
        error: "Token rejeitado: FFMPEG_WORKER_TOKEN não confere com o AUTH_TOKEN do Railway",
      }, 200);
    }
    if (!r.ok) {
      return json({
        ok: false,
        code: "bad_status",
        status: r.status,
        latency_ms,
        error: `Worker respondeu HTTP ${r.status}`,
        worker_response: body.slice(0, 300),
      }, 200);
    }
    return json({ ok: true, code: "online", status: 200, latency_ms, worker_response: body.slice(0, 300) });
  } catch (e) {
    const latency_ms = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    return json({
      ok: false,
      code: "unreachable",
      latency_ms,
      error: "Worker inacessível: confira se a URL começa com https:// e se o deploy no Railway terminou",
      detail: msg,
    }, 200);
  } finally {
    clearTimeout(timer);
  }
}

// Backward-compat alias
async function testFfmpegWorker(): Promise<Response> { return pingFfmpegWorker(); }


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Manual actions (POST body) — ffmpeg frame extraction
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({} as any));
      if (body?.action === "test_ffmpeg") return await testFfmpegWorker();
      if (body?.action === "scan_ffmpeg") {
        const { vod_url, fps, start, end, width } = body;
        if (!vod_url) return json({ error: "vod_url required" }, 400);
        return await proxyFfmpegScan({ vod_url, fps, start, end, width });
      }
      if (body?.action === "scan_vod_ffmpeg") return await scanVodFfmpeg(body);
    }
    // Default: cron tick — poll queue
    const summary = await tick();
    return json({ ok: true, ...summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[vod-scan-worker]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});

