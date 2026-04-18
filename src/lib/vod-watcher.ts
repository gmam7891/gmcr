import { supabase } from "@/integrations/supabase/client";

export interface WatcherStartResult {
  audit_id: string;
  total_frames: number;
  total_minutes: number;
  chapters: number;
  message: string;
}

export interface AuditReportGame {
  game: string;
  provider: string;
  frames: number;
  seconds: number;
  avgConfidence: number;
}

export interface AuditReport {
  audit_id: string;
  vod_id: string;
  streamer_login: string;
  vod_duration_seconds: number;
  total_casino_seconds: number;
  total_other_seconds: number;
  games: AuditReportGame[];
  summary: string;
  sullygnome: any;
  pending_audits: number;
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
