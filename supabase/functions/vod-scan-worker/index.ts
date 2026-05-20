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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const summary = await tick();
    return json({ ok: true, ...summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[vod-scan-worker]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
