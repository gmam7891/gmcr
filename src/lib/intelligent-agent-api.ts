import { supabase } from "@/integrations/supabase/client";

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("intelligent-vod-agent", { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

export const learnGame = (gameLibraryId: string) =>
  call({ action: "learn_game", game_library_id: gameLibraryId });

export const learnAllPending = (limit = 2) => call({ action: "learn_all_pending", limit });

export const analyzeVod = (vodId: string) => call({ action: "analyze_vod", vod_id: vodId });

export const getVodAnalyses = (vodId: string) =>
  call({ action: "get_vod_analyses", vod_id: vodId });


export const getAgentDashboard = () => call({ action: "get_dashboard" });

export interface DetectionStats {
  total: number;
  non_gameplay: number;
  no_game: number;
  hallucinated: number;
  low_confidence: number;
  review_skipped: number;
  promoted: number;
  promoted_by_phash: number;
  phash_override: number;
  phash_fired: number;
  total_detections: number;
  gameplay_tiles: number;
  gemini_named: number;
  override_rate: number;
  phash_detection_share: number;
  hallucination_rate: number;
}

export interface DetectionStatsResponse {
  run: {
    id?: string;
    vod_id?: string;
    streamer_login?: string;
    status?: string;
    created_at?: string;
  } | null;
  scope: "run" | "all";
  stats: DetectionStats;
}

export const getDetectionStats = (runId?: string): Promise<DetectionStatsResponse> =>
  call({ action: "get_detection_stats", ...(runId ? { run_id: runId } : {}) });

export const soloStart = (vodId: string, streamerLogin: string) =>
  call({ action: "solo_start", vod_id: vodId, streamer_login: streamerLogin });

export const soloStatus = (runId?: string) =>
  call({ action: "solo_status", ...(runId ? { run_id: runId } : {}) });

export interface AgentAnalysis {
  id: string;
  vod_id: string;
  game_library_id: string | null;
  game_name: string;
  provider_name: string | null;
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
  confidence: number;
  keyword_confidence: number;
  visual_confidence: number;
  agrees_with_pipeline: boolean | null;
  user_confirmed: boolean;
  user_corrected: boolean;
}
