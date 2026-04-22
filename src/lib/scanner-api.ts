import { supabase } from "@/integrations/supabase/client";

async function callRead(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("scanner-read", { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

async function callWrite(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("scanner-write", { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

// ─── WRITES (admin only) ──────────────────
export async function saveRawEvidences(evidences: any[], processingBatchId?: string) {
  return callWrite({ action: "save_raw_evidences", evidences, processing_batch_id: processingBatchId });
}
export async function validateVod(vodId: string) {
  return callWrite({ action: "validate_vod", vod_id: vodId });
}
export async function consolidateVod(vodId: string) {
  return callWrite({ action: "consolidate_vod", vod_id: vodId });
}
export async function computeMetrics(vodId: string, vodDurationSeconds?: number) {
  return callWrite({ action: "compute_metrics", vod_id: vodId, vod_duration_seconds: vodDurationSeconds });
}
export async function runPipeline(vodId: string, streamerLogin: string, vodDurationSeconds?: number) {
  return callWrite({ action: "run_pipeline", vod_id: vodId, streamer_login: streamerLogin, vod_duration_seconds: vodDurationSeconds });
}
export async function reviewBlock(blockId: string, newStatus: string, reviewNotes?: string, reviewerId?: string) {
  return callWrite({ action: "review_block", block_id: blockId, new_status: newStatus, review_notes: reviewNotes, reviewer_id: reviewerId });
}
export async function requestReprocess(vodId: string, streamerLogin?: string) {
  return callWrite({ action: "request_reprocess", vod_id: vodId, streamer_login: streamerLogin });
}
export async function updatePipelineConfig(configKey: string, configValue: number) {
  return callWrite({ action: "update_pipeline_config", config_key: configKey, config_value: configValue });
}
export async function enqueueJob(params: {
  job_type: string; streamer_login: string; platform?: string;
  source_id?: string; priority?: string; metadata?: Record<string, unknown>;
}) {
  return callWrite({ action: "enqueue_job", ...params });
}

// ─── READS ──────────────────
export async function getVodAuditDetail(vodId: string) {
  return callRead({ action: "get_vod_audit_detail", vod_id: vodId });
}
export async function getReviewQueue() {
  return callRead({ action: "get_review_queue" });
}
export async function getQualityMetrics() {
  return callRead({ action: "get_quality_metrics" });
}
export async function getResultsAggregated(params: {
  date_from?: string; date_to?: string; streamer?: string;
  block_status_filter?: string; group_by?: "game" | "vod" | "streamer_game";
}) {
  return callRead({ action: "get_results_aggregated", ...params });
}
export async function getPipelineConfig() {
  return callRead({ action: "get_pipeline_config" });
}
export async function getSystemStatus() {
  return callRead({ action: "get_status" });
}
export async function getDashboardData(filters: {
  date_from?: string; date_to?: string; platform?: string; provider_id?: string;
  game_id?: string; streamer?: string; source_type?: string; block_status_filter?: string;
}) {
  return callRead({ action: "get_dashboard", ...filters });
}
export async function getRankings(params: {
  date_from?: string; date_to?: string; rank_by: "streamer" | "provider" | "game"; block_status_filter?: string;
}) {
  return callRead({ action: "get_rankings", ...params });
}
export async function getTrendWeekly(params: {
  date_to?: string; streamers?: string[]; provider_ids?: string[]; platform?: string;
}) {
  return callRead({ action: "get_trend_weekly", ...params });
}
export async function getQueue(status?: string) {
  return callRead({ action: "get_queue", status });
}
export async function getChatStats(params: {
  streamer_login?: string; date_from?: string; date_to?: string;
}) {
  return callRead({ action: "get_chat_stats", ...params });
}

// ─── Misc (still routed via legacy proxy for compat) ──────────────────
export async function processVod(vodId: string, streamerLogin: string) {
  const { data, error } = await supabase.functions.invoke("scanner-pipeline", {
    body: { action: "process_vod", vod_id: vodId, streamer_login: streamerLogin },
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function saveDetections(detections: any[]) {
  const { data, error } = await supabase.functions.invoke("scanner-pipeline", {
    body: { action: "save_detections", detections },
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function reconcile(streamerLogin: string, sourceId?: string, sourceType?: string) {
  const { data, error } = await supabase.functions.invoke("scanner-pipeline", {
    body: { action: "reconcile", streamer_login: streamerLogin, source_id: sourceId, source_type: sourceType },
  });
  if (error) throw new Error(error.message);
  return data;
}

// ─── Direct DB ──────────────────
export async function getProviders() {
  const { data } = await supabase.from("providers").select("*").order("name");
  return data || [];
}
export async function getGames(providerId?: string) {
  let query = supabase.from("games").select("*");
  if (providerId) query = query.eq("provider_id", providerId);
  const { data } = await query.order("name");
  return data || [];
}
export async function getVodAudits(filters?: { streamer?: string; status?: string }) {
  let query = supabase.from("vod_audits").select("*");
  if (filters?.streamer) query = query.eq("streamer_login", filters.streamer);
  if (filters?.status) query = query.eq("status", filters.status as any);
  const { data } = await query.order("created_at", { ascending: false }).limit(100);
  return data || [];
}
