// vod-scan-worker — processa jobs `vod_process` da fila processing_queue.
// Estratégia: delega ao intelligent-vod-agent (solo_start/solo_resume) e
// espelha o progresso em processing_queue.metadata. Idempotente, seguro p/ cron.
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

const MAX_PARALLEL = 2;     // máx. jobs running simultâneos
const STALL_AFTER_MIN = 15; // requeue jobs running parados há > 15min

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function extractVodId(url: string): string | null {
  const m = url.match(/twitch\.tv\/videos?\/(\d+)/i) || url.match(/\/(\d{8,})(?:\?|$|\/)/);
  return m ? m[1] : null;
}

async function invokeAgent(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/intelligent-vod-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* ignore */ }
  if (!res.ok) throw new Error(data?.error || text || `agent error ${res.status}`);
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
  const streamer = job.streamer_login && job.streamer_login !== "unknown" ? job.streamer_login : (meta.streamer_login || "");
  if (!streamer) {
    await patchJob(job.id, {
      status: "failed",
      error_message: "Streamer não informado. Preencha o campo Streamer ou use uma URL com login.",
      completed_at: new Date().toISOString(),
    });
    return;
  }

  // marca running e dispara solo_start
  await patchJob(job.id, {
    status: "running",
    started_at: new Date().toISOString(),
    attempts: (job.attempts || 0) + 1,
    metadata: { ...meta, vod_id: vodId, current_step: "starting", progress_percent: 1 },
  });

  try {
    const out = await invokeAgent({ action: "solo_start", vod_id: vodId, streamer_login: streamer });
    if (!out?.run_id) throw new Error("solo_start não retornou run_id");
    await mergeMetadata(job.id, {
      run_id: out.run_id,
      total_mosaics: out.total_mosaics,
      total_tiles: out.total_tiles,
      current_step: "processing",
      progress_percent: 3,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await patchJob(job.id, {
      status: "failed",
      error_message: `solo_start: ${msg}`,
      completed_at: new Date().toISOString(),
    });
  }
}

// ─── Poll a running job ──────────────────────────────────────────────────
async function pollJob(job: any) {
  const meta = job.metadata || {};
  const runId: string | undefined = meta.run_id;
  if (!runId) {
    // running sem run_id → estado inconsistente, devolve para pending
    await patchJob(job.id, { status: "pending", error_message: "running sem run_id; requeued" });
    return;
  }

  const { data: run } = await sb.from("agent_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) {
    await patchJob(job.id, {
      status: "failed",
      error_message: "agent_run desapareceu",
      completed_at: new Date().toISOString(),
    });
    return;
  }

  // progresso
  const total = run.total_mosaics || 1;
  const done = run.cursor_mosaic || 0;
  const pct = Math.max(3, Math.min(99, Math.round((done / total) * 100)));

  if (run.status === "running" || run.status === "queued") {
    // Stall protection: se o agent_run não avança há tempo, dá um nudge solo_resume
    const lastUpdated = run.updated_at ? new Date(run.updated_at).getTime() : 0;
    const stalledMin = (Date.now() - lastUpdated) / 60000;
    if (stalledMin > 2) {
      try { await invokeAgent({ action: "solo_resume", run_id: runId }); } catch (_) { /* fire-and-forget */ }
    }
    await mergeMetadata(job.id, {
      progress_percent: pct,
      current_step: `mosaic ${done}/${total}`,
      detections_count: run.detections_count || 0,
    });
    return;
  }

  if (run.status === "completed") {
    // Agrega análises do VOD para gerar resultado
    const vodId = meta.vod_id || run.vod_id;
    const { data: analyses } = await sb
      .from("agent_analyses")
      .select("duration_seconds, game_name, provider_name")
      .eq("vod_id", vodId);

    const casinoSeconds = (analyses || []).reduce((s, a) => s + (a.duration_seconds || 0), 0);
    const vodDuration = (run.total_tiles || 0) * 30; // tile = 30s aprox.
    const casinoPercent = vodDuration > 0 ? (casinoSeconds / vodDuration) * 100 : 0;

    await mergeMetadata(job.id, {
      progress_percent: 100,
      current_step: "done",
      result: {
        casino_seconds: casinoSeconds,
        casino_percent: Number(casinoPercent.toFixed(2)),
        detections_count: (analyses || []).length,
        vod_duration_seconds: vodDuration,
      },
    });
    await patchJob(job.id, {
      status: "completed",
      completed_at: new Date().toISOString(),
    });
    return;
  }

  if (run.status === "failed") {
    await patchJob(job.id, {
      status: "failed",
      error_message: run.error_message || "agent_run failed",
      completed_at: new Date().toISOString(),
    });
    return;
  }
}

// ─── Tick: avança fila ───────────────────────────────────────────────────
async function tick() {
  // 1) Requeue stalls (running sem updated_at recente, sem run_id)
  const stallCutoff = new Date(Date.now() - STALL_AFTER_MIN * 60_000).toISOString();
  await sb
    .from("processing_queue")
    .update({ status: "pending", error_message: "stalled; requeued by worker" })
    .eq("job_type", "vod_process")
    .eq("status", "running")
    .lt("updated_at", stallCutoff)
    .is("metadata->>run_id", null);

  // 2) Polla os running atuais
  const { data: running } = await sb
    .from("processing_queue")
    .select("*")
    .eq("job_type", "vod_process")
    .eq("status", "running")
    .order("started_at", { ascending: true })
    .limit(MAX_PARALLEL);
  for (const j of running || []) await pollJob(j);

  // 3) Inicia novos pendentes até atingir MAX_PARALLEL
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

  return {
    polled: running?.length || 0,
    started: slots,
  };
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
