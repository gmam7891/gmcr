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

export const submitFeedback = (params: {
  analysis_id: string;
  correction_type: "confirmed" | "wrong_game" | "wrong_provider" | "false_positive";
  corrected_game_id?: string | null;
  notes?: string;
  user_id?: string;
}) => call({ action: "submit_feedback", ...params });

export const getAgentDashboard = () => call({ action: "get_dashboard" });

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
