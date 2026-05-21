import { useQuery } from "@tanstack/react-query";
import {
  getDashboardData, getRankings, getTrendWeekly, getResultsAggregated,
  getProviders, getGames,
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
    queryKey: ["scanner", "rankings", rankBy, filters],
    queryFn: () => getRankings({
      date_from: filters.date_from,
      date_to: filters.date_to,
      rank_by: rankBy,
      streamers: filters.streamers.length ? filters.streamers : undefined,
      provider_ids: filters.provider_ids.length ? filters.provider_ids : undefined,
      platform: filters.platform || undefined,
      source_type: filters.source_type || undefined,
      game_id: filters.game_id || undefined,
    }),
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
    queryKey: ["scanner", "results", groupBy, filters],
    queryFn: () => getResultsAggregated({
      streamer: filters.streamers.length === 1 ? filters.streamers[0] : (filters.streamer || undefined),
      streamers: filters.streamers.length > 1 ? filters.streamers : undefined,
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
      platform: filters.platform || undefined,
      source_type: filters.source_type || undefined,
      provider_ids: filters.provider_ids.length ? filters.provider_ids : undefined,
      game_id: filters.game_id || undefined,
      group_by: groupBy,
      block_status_filter: "confirmed",
    }),
    staleTime: STALE,
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
