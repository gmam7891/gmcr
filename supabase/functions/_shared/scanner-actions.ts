// Shared action handlers for scanner-* edge functions.
// Split: READ_ACTIONS = safe queries; WRITE_ACTIONS = mutations (require admin).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const READ_ACTIONS = new Set([
  "get_status",
  "get_dashboard",
  "get_rankings",
  "get_trend_weekly",
  "get_results_aggregated",
  "get_review_queue",
  "get_quality_metrics",
  "get_pipeline_config",
  "get_vod_audit_detail",
  "get_queue",
  "get_chat_stats",
]);

export const WRITE_ACTIONS = new Set([
  "save_raw_evidences",
  "validate_vod",
  "consolidate_vod",
  "compute_metrics",
  "run_pipeline",
  "review_block",
  "request_reprocess",
  "update_pipeline_config",
  "enqueue_job",
  "save_detections",
  "reconcile",
  "process_vod",
]);

// ─────────────── READS ───────────────
export async function handleRead(supabase: SupabaseClient, body: any) {
  const { action } = body;

  if (action === "get_status") {
    const [audits, blocks, queue] = await Promise.all([
      supabase.from("vod_audits").select("id", { count: "exact", head: true }),
      supabase.from("gameplay_blocks").select("id", { count: "exact", head: true }),
      supabase.from("processing_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    return { total_vods_audited: audits.count || 0, total_blocks: blocks.count || 0, pending_jobs: queue.count || 0 };
  }

  if (action === "get_dashboard") {
    const { date_from, date_to, platform, streamer, block_status_filter } = body;
    let query = supabase.from("gameplay_blocks").select("*");
    if (streamer) query = query.eq("streamer_login", streamer);
    if (platform) query = query.eq("platform", platform);
    if (block_status_filter && block_status_filter !== "all") query = query.eq("status", block_status_filter);
    if (date_from) query = query.gte("created_at", date_from);
    if (date_to) query = query.lte("created_at", date_to);
    const { data: blocks } = await query.order("created_at", { ascending: false }).limit(500);
    if (!blocks?.length) {
      return {
        total_exposure_seconds: 0, total_viewer_minutes: 0, unique_streamers: 0,
        total_detections: 0, avg_vod_coverage: 0,
        provider_share: {}, game_share: {}, chat_sentiment: {},
      };
    }
    const totalExposure = blocks.reduce((s: number, b: any) => s + (b.duration_seconds || 0), 0);
    const uniqueStreamers = new Set(blocks.map((b: any) => b.streamer_login)).size;
    const providerShare: Record<string, number> = {};
    const gameShare: Record<string, number> = {};
    for (const b of blocks) {
      if (b.provider_name) providerShare[b.provider_name] = (providerShare[b.provider_name] || 0) + (b.duration_seconds || 0);
      if (b.game_name) gameShare[b.game_name] = (gameShare[b.game_name] || 0) + (b.duration_seconds || 0);
    }
    const { data: audits } = await supabase.from("vod_audits").select("coverage_percent, pending_audit_segments, vod_duration_seconds").limit(100);
    const avgCoverage = audits?.length ? audits.reduce((s: number, a: any) => s + (a.coverage_percent || 0), 0) / audits.length : 0;
    const twitchCategoryShare: Record<string, number> = {};
    for (const a of audits || []) {
      const segs: any = (a as any).pending_audit_segments;
      const chapters = segs?.plan?.chapters;
      if (Array.isArray(chapters)) {
        for (const ch of chapters) {
          const name = (ch.game || "Unknown").trim();
          twitchCategoryShare[name] = (twitchCategoryShare[name] || 0) + (ch.durationSeconds || 0);
        }
      }
    }
    const allKeys = new Set([...Object.keys(gameShare), ...Object.keys(twitchCategoryShare)]);
    const aiVsTwitch = Array.from(allKeys).map((name) => ({
      name, ai_seconds: gameShare[name] || 0, twitch_seconds: twitchCategoryShare[name] || 0,
    })).sort((a, b) => (b.ai_seconds + b.twitch_seconds) - (a.ai_seconds + a.twitch_seconds)).slice(0, 10);
    return {
      total_exposure_seconds: totalExposure, total_viewer_minutes: Math.round(totalExposure / 60),
      unique_streamers: uniqueStreamers, total_detections: blocks.length, avg_vod_coverage: avgCoverage,
      provider_share: providerShare, game_share: gameShare, twitch_category_share: twitchCategoryShare,
      ai_vs_twitch: aiVsTwitch, chat_sentiment: {},
    };
  }

  if (action === "get_rankings") {
    const { rank_by, date_from, date_to, block_status_filter } = body;
    let query = supabase.from("gameplay_blocks").select("*").eq("status", block_status_filter || "confirmed");
    if (date_from) query = query.gte("created_at", date_from);
    if (date_to) query = query.lte("created_at", date_to);
    const { data: blocks } = await query.limit(1000);
    if (!blocks?.length) return { rankings: [] };
    const agg: Record<string, any> = {};
    for (const b of blocks) {
      const k = rank_by === "streamer" ? b.streamer_login
        : rank_by === "provider" ? (b.provider_name || "Unknown")
        : (b.game_name || "Unknown");
      if (!agg[k]) agg[k] = { key: k, exposure: 0, sessions: 0, viewer_minutes: 0, peak: 0 };
      agg[k].exposure += b.duration_seconds || 0;
      agg[k].sessions++;
      agg[k].viewer_minutes += Math.round((b.duration_seconds || 0) / 60);
    }
    const rankings = Object.values(agg).sort((a: any, b: any) => b.exposure - a.exposure).slice(0, 20);
    return { rankings };
  }

  if (action === "get_trend_weekly") {
    const { date_to, streamers, platform } = body;
    const refTo = date_to ? new Date(date_to) : new Date();
    const endCur = new Date(refTo);
    const startCur = new Date(endCur.getTime() - 7 * 86400000);
    const startPrev = new Date(startCur.getTime() - 7 * 86400000);
    async function fetchRange(from: Date, to: Date) {
      let q = supabase.from("gameplay_blocks")
        .select("provider_name,duration_seconds,streamer_login,platform,created_at,status")
        .eq("status", "confirmed")
        .gte("created_at", from.toISOString())
        .lte("created_at", to.toISOString());
      if (platform) q = q.eq("platform", platform);
      if (Array.isArray(streamers) && streamers.length) q = q.in("streamer_login", streamers);
      const { data } = await q.limit(5000);
      const share: Record<string, number> = {};
      for (const b of data || []) {
        const k = (b as any).provider_name || "Unknown";
        share[k] = (share[k] || 0) + ((b as any).duration_seconds || 0);
      }
      return share;
    }
    const [cur, prev] = await Promise.all([fetchRange(startCur, endCur), fetchRange(startPrev, startCur)]);
    const keys = new Set([...Object.keys(cur), ...Object.keys(prev)]);
    const trend = Array.from(keys).map((name) => {
      const c = cur[name] || 0;
      const p = prev[name] || 0;
      const delta = c - p;
      const deltaPct = p > 0 ? (delta / p) * 100 : (c > 0 ? 100 : 0);
      return { name, current: c, previous: p, delta, delta_pct: deltaPct };
    }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 12);
    return {
      range: {
        current: { from: startCur.toISOString(), to: endCur.toISOString() },
        previous: { from: startPrev.toISOString(), to: startCur.toISOString() },
      },
      trend,
    };
  }

  if (action === "get_results_aggregated") {
    const { date_from, date_to, streamer, block_status_filter, group_by } = body;
    let query = supabase.from("gameplay_blocks").select("*");
    if (block_status_filter && block_status_filter !== "all") query = query.eq("status", block_status_filter);
    else if (!block_status_filter) query = query.eq("status", "confirmed");
    if (date_from) query = query.gte("created_at", date_from);
    if (date_to) query = query.lte("created_at", date_to);
    if (streamer) query = query.eq("streamer_login", streamer);
    const { data: blocks } = await query.order("created_at", { ascending: false }).limit(2000);
    if (!blocks?.length) return { aggregated: [], totals: { games: 0, blocks: 0, exposure_seconds: 0, vods: 0, streamers: 0 }, blocks: [] };
    const agg: Record<string, any> = {};
    for (const b of blocks) {
      const game = b.game_name || "Unknown";
      const provider = b.provider_name || "Unknown";
      const key = group_by === "vod" ? `${b.vod_id}::${game}` : group_by === "streamer_game" ? `${b.streamer_login}::${game}` : game;
      if (!agg[key]) agg[key] = { key, game, provider, exposure_seconds: 0, sessions: 0, avg_confidence: 0, vods: new Set(), streamers: new Set() };
      agg[key].exposure_seconds += b.duration_seconds || 0;
      agg[key].sessions++;
      agg[key].avg_confidence += Number(b.confidence_avg) || 0;
      agg[key].vods.add(b.vod_id);
      agg[key].streamers.add(b.streamer_login);
    }
    const aggregated = Object.values(agg).map((a: any) => ({
      key: a.key, game: a.game, provider: a.provider, exposure_seconds: a.exposure_seconds,
      exposure_minutes: Math.round(a.exposure_seconds / 60), sessions: a.sessions,
      avg_confidence: a.sessions > 0 ? a.avg_confidence / a.sessions : 0,
      vods_count: a.vods.size, streamers_count: a.streamers.size,
    })).sort((a: any, b: any) => b.exposure_seconds - a.exposure_seconds);
    const totalExposure = blocks.reduce((s: number, b: any) => s + (b.duration_seconds || 0), 0);
    return {
      aggregated,
      totals: {
        games: new Set(blocks.map((b: any) => b.game_name || "Unknown")).size,
        blocks: blocks.length, exposure_seconds: totalExposure, exposure_minutes: Math.round(totalExposure / 60),
        vods: new Set(blocks.map((b: any) => b.vod_id)).size,
        streamers: new Set(blocks.map((b: any) => b.streamer_login)).size,
      },
      blocks: blocks.slice(0, 500).map((b: any) => ({
        id: b.id, vod_id: b.vod_id, streamer_login: b.streamer_login, game_name: b.game_name, provider_name: b.provider_name,
        start_seconds: b.start_seconds, end_seconds: b.end_seconds, duration_seconds: b.duration_seconds,
        confidence_avg: b.confidence_avg, status: b.status, created_at: b.created_at,
      })),
    };
  }

  if (action === "get_review_queue") {
    const { data } = await supabase.from("gameplay_blocks").select("*")
      .in("status", ["suspect", "needs_review"]).order("created_at", { ascending: false }).limit(50);
    return { queue: data || [] };
  }

  if (action === "get_quality_metrics") {
    const { data: audits } = await supabase.from("vod_audits").select("*").limit(200);
    if (!audits?.length) return { confirmed_blocks: 0, suspect_blocks: 0, false_positive_rate: 0, avg_coverage: 0, avg_confidence: 0 };
    const confirmed = audits.reduce((s: number, a: any) => s + (a.confirmed_blocks || 0), 0);
    const suspect = audits.reduce((s: number, a: any) => s + (a.suspect_blocks || 0), 0);
    const discarded = audits.reduce((s: number, a: any) => s + (a.discarded_blocks || 0), 0);
    const total = confirmed + suspect + discarded;
    const fpr = total > 0 ? (discarded / total) * 100 : 0;
    const avgCoverage = audits.reduce((s: number, a: any) => s + (a.coverage_percent || 0), 0) / audits.length;
    const avgConfidence = audits.reduce((s: number, a: any) => s + (a.confidence_score || 0), 0) / audits.length;
    return { confirmed_blocks: confirmed, suspect_blocks: suspect, false_positive_rate: fpr, avg_coverage: avgCoverage, avg_confidence: avgConfidence };
  }

  if (action === "get_pipeline_config") {
    const { data } = await supabase.from("pipeline_configs").select("*").order("config_key");
    return { configs: data || [] };
  }

  if (action === "get_vod_audit_detail") {
    const { vod_id } = body;
    const [blocksRes, evidencesRes, logsRes] = await Promise.all([
      supabase.from("gameplay_blocks").select("*").eq("vod_id", vod_id).order("start_seconds"),
      supabase.from("raw_evidences").select("id, is_valid, validation_status, confidence_score, game_detected, provider_detected").eq("vod_id", vod_id),
      supabase.from("pipeline_audit_logs").select("*").eq("vod_id", vod_id).order("created_at", { ascending: false }).limit(20),
    ]);
    const evidences = evidencesRes.data || [];
    return {
      blocks: blocksRes.data || [], logs: logsRes.data || [],
      evidence_summary: {
        total: evidences.length,
        valid: evidences.filter((e: any) => e.is_valid).length,
        discarded: evidences.filter((e: any) => !e.is_valid).length,
      },
    };
  }

  if (action === "get_queue") {
    const { status } = body;
    let query = supabase.from("processing_queue").select("*");
    if (status) query = query.eq("status", status);
    const { data } = await query.order("created_at", { ascending: false }).limit(50);
    return { queue: data || [] };
  }

  if (action === "get_chat_stats") {
    const { streamer_login, date_from, date_to } = body;
    let query = supabase.from("chat_messages").select("sentiment_label");
    if (streamer_login) query = query.eq("streamer_login", streamer_login);
    if (date_from) query = query.gte("message_at", date_from);
    if (date_to) query = query.lte("message_at", date_to);
    const { data } = await query.limit(1000);
    const sentiment: Record<string, number> = { positive: 0, neutral: 0, negative: 0 };
    for (const m of data || []) {
      if ((m as any).sentiment_label && sentiment[(m as any).sentiment_label] !== undefined) {
        sentiment[(m as any).sentiment_label]++;
      }
    }
    return { sentiment, total: data?.length || 0 };
  }

  return null;
}

// ─────────────── WRITES (admin only) ───────────────
export async function handleWrite(supabase: SupabaseClient, body: any) {
  const { action } = body;

  if (action === "save_raw_evidences") {
    const { evidences, processing_batch_id } = body;
    if (!evidences?.length) return { saved: 0 };
    const rows = evidences.map((e: any) => ({
      vod_id: e.vod_id, streamer_login: e.streamer_login, platform: e.platform || "twitch",
      source_type: e.source_type || "vod", source_id: e.source_id || e.vod_id,
      timestamp_seconds: e.timestamp_seconds || 0, game_detected: e.game || null,
      provider_detected: e.provider || null, confidence_score: e.confidence || 0,
      processing_batch_id: processing_batch_id || null, validation_status: "pending", is_valid: true,
    }));
    const { error } = await supabase.from("raw_evidences").insert(rows);
    if (error) throw new Error(`save_raw_evidences: ${error.message}`);
    return { saved: rows.length };
  }

  if (action === "validate_vod") {
    const { vod_id } = body;
    const { data: evidences } = await supabase.from("raw_evidences").select("*")
      .eq("vod_id", vod_id).eq("validation_status", "pending");
    if (!evidences?.length) return { validated: 0 };
    let valid = 0, discarded = 0;
    for (const ev of evidences) {
      const isValid = ((ev as any).confidence_score || 0) >= 0.3;
      await supabase.from("raw_evidences").update({
        is_valid: isValid, validation_status: isValid ? "valid" : "discarded",
        discard_reason: isValid ? null : "low_confidence",
      }).eq("id", (ev as any).id);
      if (isValid) valid++; else discarded++;
    }
    return { validated: valid, discarded };
  }

  if (action === "consolidate_vod") {
    const { vod_id } = body;
    const { data: evidences } = await supabase.from("raw_evidences").select("*")
      .eq("vod_id", vod_id).eq("is_valid", true).order("timestamp_seconds", { ascending: true });
    if (!evidences?.length) return { blocks: 0 };
    const blocks: any[] = []; let current: any = null;
    for (const ev of evidences as any[]) {
      if (!current || current.game !== ev.game_detected || (ev.timestamp_seconds - current.endSec) > 180) {
        if (current && current.count >= 2) blocks.push(current);
        current = { game: ev.game_detected, provider: ev.provider_detected, startSec: ev.timestamp_seconds, endSec: ev.timestamp_seconds + 60, confidences: [ev.confidence_score], count: 1 };
      } else {
        current.endSec = ev.timestamp_seconds + 60;
        current.confidences.push(ev.confidence_score);
        current.count++;
      }
    }
    if (current && current.count >= 2) blocks.push(current);
    const streamerLogin = (evidences[0] as any).streamer_login;
    const rows = blocks.map((b: any) => ({
      vod_id, streamer_login: streamerLogin, platform: "twitch", source_type: "vod", source_id: vod_id,
      game_name: b.game, provider_name: b.provider, start_seconds: b.startSec, end_seconds: b.endSec,
      duration_seconds: b.endSec - b.startSec, evidence_count: b.count,
      confidence_avg: b.confidences.reduce((a: number, c: number) => a + c, 0) / b.confidences.length,
      confidence_min: Math.min(...b.confidences), confidence_max: Math.max(...b.confidences), status: "confirmed",
    }));
    if (rows.length) await supabase.from("gameplay_blocks").insert(rows);
    return { confirmed: rows.length };
  }

  if (action === "compute_metrics") {
    const { vod_id, vod_duration_seconds } = body;
    const { data: evidences } = await supabase.from("raw_evidences").select("id, is_valid").eq("vod_id", vod_id);
    const { data: blocks } = await supabase.from("gameplay_blocks").select("*").eq("vod_id", vod_id);
    const totalEv = evidences?.length || 0;
    const validEv = evidences?.filter((e: any) => e.is_valid)?.length || 0;
    const confirmed = blocks?.filter((b: any) => b.status === "confirmed") || [];
    const processedDur = confirmed.reduce((s: number, b: any) => s + (b.duration_seconds || 0), 0);
    const vodDur = vod_duration_seconds || 3600;
    const coverage = Math.min(100, Math.round((processedDur / vodDur) * 100));
    const confs = confirmed.map((b: any) => b.confidence_avg || 0);
    const avgConf = confs.length ? confs.reduce((a: number, c: number) => a + c, 0) / confs.length : 0;
    const auditRow = {
      vod_id, streamer_login: (blocks?.[0] as any)?.streamer_login || "unknown", platform: "twitch",
      status: "completed" as const, vod_duration_seconds: vodDur, processed_duration_seconds: processedDur,
      coverage_percent: coverage, confidence_score: Math.round(avgConf * 100),
      total_evidences: totalEv, valid_evidences: validEv, discarded_evidences: totalEv - validEv,
      confirmed_blocks: confirmed.length,
      suspect_blocks: blocks?.filter((b: any) => b.status === "suspect")?.length || 0,
      discarded_blocks: blocks?.filter((b: any) => b.status === "discarded")?.length || 0,
      completed_at: new Date().toISOString(),
    };
    const { data: existing } = await supabase.from("vod_audits").select("id").eq("vod_id", vod_id).maybeSingle();
    if (existing) await supabase.from("vod_audits").update(auditRow).eq("vod_id", vod_id);
    else await supabase.from("vod_audits").insert(auditRow);
    return { coverage, confidence: Math.round(avgConf * 100), confirmed: confirmed.length };
  }

  if (action === "run_pipeline") {
    const { vod_id, streamer_login, vod_duration_seconds } = body;
    const validate = await handleWrite(supabase, { action: "validate_vod", vod_id });
    const consolidate = await handleWrite(supabase, { action: "consolidate_vod", vod_id });
    const metrics = await handleWrite(supabase, { action: "compute_metrics", vod_id, vod_duration_seconds });
    await supabase.from("pipeline_audit_logs").insert({
      action: "run_pipeline", entity_type: "vod", entity_id: vod_id, vod_id,
      details: { streamer_login, validate, consolidate, metrics },
    });
    return { pipeline: "completed", vod_id, validate, consolidate, metrics };
  }

  if (action === "review_block") {
    const { block_id, new_status, review_notes, reviewer_id } = body;
    const { error } = await supabase.from("gameplay_blocks").update({
      status: new_status, review_notes, reviewed_by: reviewer_id || null,
      reviewed_at: new Date().toISOString(),
    }).eq("id", block_id);
    if (error) throw new Error(error.message);
    await supabase.from("pipeline_audit_logs").insert({
      action: "review_block", entity_type: "gameplay_block", entity_id: block_id,
      details: { new_status, review_notes }, performed_by: reviewer_id || null,
    });
    return { success: true };
  }

  if (action === "request_reprocess") {
    const { vod_id } = body;
    await supabase.from("gameplay_blocks").delete().eq("vod_id", vod_id);
    await supabase.from("raw_evidences").delete().eq("vod_id", vod_id);
    await supabase.from("vod_audits").update({ status: "reprocessed" as const }).eq("vod_id", vod_id);
    return { reprocessed: true, vod_id };
  }

  if (action === "update_pipeline_config") {
    const { config_key, config_value } = body;
    const { error } = await supabase.from("pipeline_configs").upsert({
      config_key, config_value, updated_at: new Date().toISOString(),
    }, { onConflict: "config_key" });
    if (error) throw new Error(error.message);
    return { success: true };
  }

  if (action === "enqueue_job") {
    const { job_type, streamer_login, platform, source_id, priority, metadata } = body;
    const { error } = await supabase.from("processing_queue").insert({
      job_type, streamer_login, platform: platform || "twitch", source_id,
      priority: priority || "normal", metadata: metadata || {},
    });
    if (error) throw new Error(error.message);
    return { enqueued: true };
  }

  return null;
}

// ─────────────── AUTH HELPERS ───────────────
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function authenticate(req: Request): Promise<{ userId: string; supabase: SupabaseClient } | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized: missing bearer token" }, 401);
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
  if (claimsErr || !claimsData?.claims?.sub) {
    return jsonResponse({ error: "Unauthorized: invalid token" }, 401);
  }
  return {
    userId: claimsData.claims.sub as string,
    supabase: createClient(supabaseUrl, serviceKey),
  };
}

export async function requireAdmin(supabase: SupabaseClient, userId: string): Promise<Response | null> {
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isAdmin) return jsonResponse({ error: "Forbidden: admin role required" }, 403);
  return null;
}
