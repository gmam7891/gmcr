import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface VodAuditProgress {
  audit_id: string;
  progress_phase: string;
  progress_message: string | null;
  progress_current_minute: number;
  progress_total_minutes: number;
  progress_games_found: number;
  pending_audit_segments: any[];
  status: string;
}

/**
 * Subscribes to realtime updates of a vod_audits row to power a live progress bar.
 * Pass `null` audit_id to disable.
 */
export function useVodAuditProgress(auditId: string | null): VodAuditProgress | null {
  const [progress, setProgress] = useState<VodAuditProgress | null>(null);

  useEffect(() => {
    if (!auditId) { setProgress(null); return; }

    // Initial fetch
    supabase
      .from("vod_audits")
      .select("id, progress_phase, progress_message, progress_current_minute, progress_total_minutes, progress_games_found, pending_audit_segments, status")
      .eq("id", auditId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setProgress({
          audit_id: data.id,
          progress_phase: (data as any).progress_phase ?? "idle",
          progress_message: (data as any).progress_message ?? null,
          progress_current_minute: (data as any).progress_current_minute ?? 0,
          progress_total_minutes: (data as any).progress_total_minutes ?? 0,
          progress_games_found: (data as any).progress_games_found ?? 0,
          pending_audit_segments: (data as any).pending_audit_segments ?? [],
          status: data.status ?? "queued",
        });
      });

    const channel = supabase
      .channel(`vod_audit_${auditId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "vod_audits", filter: `id=eq.${auditId}` }, (payload) => {
        const r = payload.new as any;
        setProgress({
          audit_id: r.id,
          progress_phase: r.progress_phase ?? "idle",
          progress_message: r.progress_message ?? null,
          progress_current_minute: r.progress_current_minute ?? 0,
          progress_total_minutes: r.progress_total_minutes ?? 0,
          progress_games_found: r.progress_games_found ?? 0,
          pending_audit_segments: r.pending_audit_segments ?? [],
          status: r.status ?? "processing",
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [auditId]);

  return progress;
}
