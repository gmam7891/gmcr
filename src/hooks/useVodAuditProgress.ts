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
  partial_reason?: string | null;
}

const TERMINAL = new Set(["completed", "failed", "partial", "needs_review", "reprocessed", "cancelled"]);

const COLUMNS =
  "id, progress_phase, progress_message, progress_current_minute, progress_total_minutes, progress_games_found, pending_audit_segments, status, partial_reason";

/**
 * Subscribes to realtime updates of a vod_audits row to power a live progress bar.
 * Hardened:
 *  - Falls back to polling when realtime channel errors or closes early.
 *  - Stops polling once the audit reaches a terminal status.
 *  - Survives transient network blips by re-subscribing.
 * Pass `null` audit_id to disable.
 */
export function useVodAuditProgress(auditId: string | null): VodAuditProgress | null {
  const [progress, setProgress] = useState<VodAuditProgress | null>(null);

  useEffect(() => {
    if (!auditId) { setProgress(null); return; }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const apply = (r: any) => {
      if (!r || cancelled) return;
      setProgress({
        audit_id: r.id,
        progress_phase: r.progress_phase ?? "idle",
        progress_message: r.progress_message ?? null,
        progress_current_minute: r.progress_current_minute ?? 0,
        progress_total_minutes: r.progress_total_minutes ?? 0,
        progress_games_found: r.progress_games_found ?? 0,
        pending_audit_segments: r.pending_audit_segments ?? [],
        status: r.status ?? "queued",
        partial_reason: r.partial_reason ?? null,
      });
      if (TERMINAL.has(r.status)) {
        if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
      }
    };

    const fetchOnce = async () => {
      const { data, error } = await supabase
        .from("vod_audits")
        .select(COLUMNS)
        .eq("id", auditId)
        .maybeSingle();
      if (!error && data) apply(data);
    };

    // Polling fallback (always armed; cleared once terminal or realtime catches up).
    const poll = async () => {
      if (cancelled) return;
      await fetchOnce();
      if (cancelled) return;
      if (progress && TERMINAL.has(progress.status)) return;
      pollTimer = setTimeout(poll, 5000);
    };

    void fetchOnce();
    pollTimer = setTimeout(poll, 5000);

    const subscribe = () => {
      channel = supabase
        .channel(`vod_audit_${auditId}_${Date.now()}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "vod_audits", filter: `id=eq.${auditId}` },
          (payload) => apply(payload.new),
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            if (channel) { void supabase.removeChannel(channel); channel = null; }
            if (!cancelled) setTimeout(subscribe, 3000);
          }
        });
    };
    subscribe();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (channel) void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId]);

  return progress;
}
