import { supabase } from "@/integrations/supabase/client";

export interface WatcherStartResult {
  audit_id: string;
  total_frames: number;
  total_minutes: number;
  chapters: number;
  message: string;
  partial_reason?: string | null;
  storyboard_reason?: string | null;
  status?: string;
}

export interface AuditReportGame {
  game: string;
  provider: string;
  frames: number;
  seconds: number;
  avgConfidence: number;
  status?: "confirmed" | "suspect";
  proof?: {
    proof_image_url?: string | null;
    timestamp_seconds?: number;
    detection_type?: "url" | "lobby_ocr" | "gameplay" | "loading" | string;
    page_url?: string | null;
    evidence?: string | null;
    tile_row?: number;
    tile_col?: number;
    is_transition_start?: boolean;
    is_new_game_ocr?: boolean;
  } | null;
}

export interface AuditReport {
  audit_id: string;
  vod_id: string;
  streamer_login: string;
  vod_duration_seconds: number;
  total_casino_seconds: number;
  total_other_seconds: number;
  state_breakdown?: {
    gameplay_seconds?: number;
    lobby_seconds?: number;
    loading_seconds?: number;
    other_seconds?: number;
  };
  games: AuditReportGame[];
  summary: string;
  sullygnome: any;
  pending_audits: number;
  audit_status?: string;
  error_message?: string | null;
  data_source?: "stream_snapshots:storyboard" | "none";
  snapshots_found?: number;
  diagnostic_log?: string | null;
  pending_review_frames?: number;
  expected_frames?: number | null;
  reconciliation_status?: "ok" | "mismatch" | "pending" | "needs_review";
  reconciliation_notes?: string | null;
  last_checkpoint_at?: string | null;
  partial_reason?: string | null;
  status?: string;
}

/** Start the autonomous VOD Watcher Agent. Returns immediately; agent runs in background. */
export async function startWatcher(params: {
  vodId: string;
  streamerLogin: string;
  vodDurationSeconds: number;
  thumbnailUrl: string;
  vodTitle: string;
}): Promise<WatcherStartResult> {
  const { data, error } = await supabase.functions.invoke("vod-watcher-agent", {
    body: {
      action: "start",
      vod_id: params.vodId,
      streamer_login: params.streamerLogin,
      vod_duration_seconds: params.vodDurationSeconds,
      thumbnail_url: params.thumbnailUrl,
      vod_title: params.vodTitle,
    },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data as WatcherStartResult;
}

/** Get consolidated report after agent finishes (or while running for partial). */
export async function getAuditReport(auditId: string): Promise<AuditReport> {
  const { data, error } = await supabase.functions.invoke("vod-watcher-agent", {
    body: { action: "report", audit_id: auditId },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data as AuditReport;
}
