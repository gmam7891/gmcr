import { supabase } from "@/integrations/supabase/client";

async function callScanner(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("scanner-pipeline", { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

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
}) {
  return callScanner({ action: "get_dashboard", ...filters });
}

export async function getRankings(params: {
  date_from?: string;
  date_to?: string;
  rank_by: "streamer" | "provider" | "game";
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
  const { data } = await supabase.from("providers" as any).select("*").order("name");
  return data || [];
}

export async function getGames(providerId?: string) {
  let query = (supabase.from("games" as any) as any).select("*, providers(name)");
  if (providerId) query = query.eq("provider_id", providerId);
  const { data } = await query.order("name");
  return data || [];
}

export async function getVodAudits(filters?: { streamer?: string; status?: string }) {
  let query = (supabase.from("vod_audits" as any) as any).select("*");
  if (filters?.streamer) query = query.eq("streamer_login", filters.streamer);
  if (filters?.status) query = query.eq("status", filters.status);
  const { data } = await query.order("created_at", { ascending: false }).limit(100);
  return data || [];
}
