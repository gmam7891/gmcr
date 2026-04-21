import { supabase } from "@/integrations/supabase/client";

async function callScanner(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("scanner-pipeline", { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

// ─── Pipeline Actions ──────────────────
export async function saveRawEvidences(evidences: any[], processingBatchId?: string) {
  return callScanner({ action: "save_raw_evidences", evidences, processing_batch_id: processingBatchId });
}

export async function validateVod(vodId: string) {
  return callScanner({ action: "validate_vod", vod_id: vodId });
}

export async function consolidateVod(vodId: string) {
  return callScanner({ action: "consolidate_vod", vod_id: vodId });
}

export async function computeMetrics(vodId: string, vodDurationSeconds?: number) {
  return callScanner({ action: "compute_metrics", vod_id: vodId, vod_duration_seconds: vodDurationSeconds });
}

export async function runPipeline(vodId: string, streamerLogin: string, vodDurationSeconds?: number) {
  return callScanner({ action: "run_pipeline", vod_id: vodId, streamer_login: streamerLogin, vod_duration_seconds: vodDurationSeconds });
}

// ─── Review Actions ──────────────────
export async function reviewBlock(blockId: string, newStatus: string, reviewNotes?: string, reviewerId?: string) {
  return callScanner({ action: "review_block", block_id: blockId, new_status: newStatus, review_notes: reviewNotes, reviewer_id: reviewerId });
}

export async function requestReprocess(vodId: string, streamerLogin?: string) {
  return callScanner({ action: "request_reprocess", vod_id: vodId, streamer_login: streamerLogin });
}

// ─── Audit Data ──────────────────
export async function getVodAuditDetail(vodId: string) {
  return callScanner({ action: "get_vod_audit_detail", vod_id: vodId });
}

export async function getReviewQueue() {
  return callScanner({ action: "get_review_queue" });
}

export async function getQualityMetrics() {
  return callScanner({ action: "get_quality_metrics" });
}

export async function getResultsAggregated(params: {
  date_from?: string;
  date_to?: string;
  streamer?: string;
  block_status_filter?: string;
  group_by?: "game" | "vod" | "streamer_game";
}) {
  return callScanner({ action: "get_results_aggregated", ...params });
}

// ─── Config ──────────────────
export async function getPipelineConfig() {
  return callScanner({ action: "get_pipeline_config" });
}

export async function updatePipelineConfig(configKey: string, configValue: number) {
  return callScanner({ action: "update_pipeline_config", config_key: configKey, config_value: configValue });
}

// ─── Existing Actions ──────────────────
export async function getSystemStatus() {
  return callScanner({ action: "get_status" });
}

export async function getDashboardData(filters: {
  date_from?: string;
  date_to?: string;
  platform?: string;
  provider_id?: string;
  game_id?: string;
  streamer?: string;
  source_type?: string;
  block_status_filter?: string;
}) {
  return callScanner({ action: "get_dashboard", ...filters });
}

export async function getRankings(params: {
  date_from?: string;
  date_to?: string;
  rank_by: "streamer" | "provider" | "game";
  block_status_filter?: string;
}) {
  return callScanner({ action: "get_rankings", ...params });
}

export async function enqueueJob(params: {
  job_type: string;
  streamer_login: string;
  platform?: string;
  source_id?: string;
  priority?: string;
  metadata?: Record<string, unknown>;
}) {
  return callScanner({ action: "enqueue_job", ...params });
}

export async function processVod(vodId: string, streamerLogin: string) {
  return callScanner({ action: "process_vod", vod_id: vodId, streamer_login: streamerLogin });
}

export async function saveDetections(detections: any[]) {
  return callScanner({ action: "save_detections", detections });
}

export async function reconcile(streamerLogin: string, sourceId?: string, sourceType?: string) {
  return callScanner({ action: "reconcile", streamer_login: streamerLogin, source_id: sourceId, source_type: sourceType });
}

export async function getQueue(status?: string) {
  return callScanner({ action: "get_queue", status });
}

export async function getChatStats(params: {
  streamer_login?: string;
  date_from?: string;
  date_to?: string;
}) {
  return callScanner({ action: "get_chat_stats", ...params });
}

// Direct DB queries for reference data
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
