import { useQuery } from "@tanstack/react-query";
import {
  getDashboardData, getRankings, getTrendWeekly, getResultsAggregated,
  getReviewQueue, getQualityMetrics, getPipelineConfig, getSystemStatus,
  getQueue, getChatStats, getVodAuditDetail, getProviders, getGames,
} from "@/lib/scanner-api";
import type { ScannerFilters } from "@/contexts/ScannerFiltersContext";

const STALE = 5 * 60 * 1000; // 5 min

export function useScannerDashboard(filters: ScannerFilters, dataFilter: string) {
  return useQuery({
    queryKey: ["scanner", "dashboard", filters, dataFilter],
    queryFn: () => getDashboardData({ ...filters, block_status_filter: dataFilter }),
    staleTime: STALE,
  });
}

export function useScannerRankings(filters: ScannerFilters, rankBy: "streamer" | "provider" | "game") {
  return useQuery({
    queryKey: ["scanner", "rankings", rankBy, filters.date_from, filters.date_to],
    queryFn: () => getRankings({ date_from: filters.date_from, date_to: filters.date_to, rank_by: rankBy }),
    staleTime: STALE,
  });
}

export function useScannerTrendWeekly(filters: ScannerFilters) {
  return useQuery({
    queryKey: ["scanner", "trend_weekly", filters.date_to, filters.streamers, filters.provider_ids, filters.platform],
    queryFn: () => getTrendWeekly({
      date_to: filters.date_to, streamers: filters.streamers,
      provider_ids: filters.provider_ids, platform: filters.platform || undefined,
    }),
    staleTime: STALE,
  });
}

export function useScannerResults(filters: ScannerFilters, groupBy: "game" | "vod" | "streamer_game") {
  return useQuery({
    queryKey: ["scanner", "results", groupBy, filters.streamer, filters.date_from, filters.date_to],
    queryFn: () => getResultsAggregated({
      streamer: filters.streamer || undefined,
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
      group_by: groupBy, block_status_filter: "confirmed",
    }),
    staleTime: STALE,
  });
}

export function useReviewQueue() {
  return useQuery({
    queryKey: ["scanner", "review_queue"],
    queryFn: getReviewQueue,
    staleTime: STALE,
  });
}

export function useQualityMetrics() {
  return useQuery({
    queryKey: ["scanner", "quality_metrics"],
    queryFn: getQualityMetrics,
    staleTime: STALE,
  });
}

export function usePipelineConfig() {
  return useQuery({
    queryKey: ["scanner", "pipeline_config"],
    queryFn: getPipelineConfig,
    staleTime: STALE,
  });
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ["scanner", "system_status"],
    queryFn: getSystemStatus,
    staleTime: 60 * 1000, // 1 min — status atualiza mais rápido
  });
}

export function useQueue(status?: string) {
  return useQuery({
    queryKey: ["scanner", "queue", status],
    queryFn: () => getQueue(status),
    staleTime: STALE,
  });
}

export function useChatStats(params: { streamer_login?: string; date_from?: string; date_to?: string }) {
  return useQuery({
    queryKey: ["scanner", "chat_stats", params],
    queryFn: () => getChatStats(params),
    staleTime: STALE,
  });
}

export function useVodAuditDetail(vodId: string | undefined) {
  return useQuery({
    queryKey: ["scanner", "vod_audit_detail", vodId],
    queryFn: () => getVodAuditDetail(vodId!),
    staleTime: STALE,
    enabled: !!vodId,
  });
}

// Reference data — long stale time (rarely changes)
export function useProviders() {
  return useQuery({
    queryKey: ["scanner", "providers"],
    queryFn: getProviders,
    staleTime: 60 * 60 * 1000, // 1h
  });
}

export function useGames(providerId?: string) {
  return useQuery({
    queryKey: ["scanner", "games", providerId],
    queryFn: () => getGames(providerId),
    staleTime: 60 * 60 * 1000,
  });
}
