import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

export interface ScannerFilters {
  date_from: string;
  date_to: string;
  platform: string;
  provider_id: string;        // legacy single-select (still read by GlobalFilters)
  game_id: string;
  streamer: string;            // legacy single-select
  source_type: string;
  // new multi-selects
  streamers: string[];
  provider_ids: string[];
}

const STORAGE_KEY = "scanner_filters_v1";

const today = new Date();
const thirtyAgo = new Date(Date.now() - 30 * 86400000);

export const defaultFilters: ScannerFilters = {
  date_from: thirtyAgo.toISOString().slice(0, 10),
  date_to: today.toISOString().slice(0, 10),
  platform: "",
  provider_id: "",
  game_id: "",
  streamer: "",
  source_type: "",
  streamers: [],
  provider_ids: [],
};

interface Ctx {
  filters: ScannerFilters;
  setFilters: (f: ScannerFilters) => void;
  patch: (p: Partial<ScannerFilters>) => void;
  reset: () => void;
}

const ScannerFiltersContext = createContext<Ctx | null>(null);

function readFromUrl(sp: URLSearchParams, fallback: ScannerFilters): ScannerFilters {
  const arr = (k: string) => {
    const v = sp.get(k);
    return v ? v.split(",").filter(Boolean) : [];
  };
  return {
    date_from: sp.get("from") || fallback.date_from,
    date_to: sp.get("to") || fallback.date_to,
    platform: sp.get("platform") || "",
    provider_id: sp.get("provider") || "",
    game_id: sp.get("game") || "",
    streamer: sp.get("streamer") || "",
    source_type: sp.get("src") || "",
    streamers: arr("streamers"),
    provider_ids: arr("providers"),
  };
}

function writeToUrl(f: ScannerFilters, sp: URLSearchParams) {
  const next = new URLSearchParams(sp);
  const set = (k: string, v: string) => v ? next.set(k, v) : next.delete(k);
  const setArr = (k: string, v: string[]) => v.length ? next.set(k, v.join(",")) : next.delete(k);
  set("from", f.date_from);
  set("to", f.date_to);
  set("platform", f.platform);
  set("provider", f.provider_id);
  set("game", f.game_id);
  set("streamer", f.streamer);
  set("src", f.source_type);
  setArr("streamers", f.streamers);
  setArr("providers", f.provider_ids);
  return next;
}

export function ScannerFiltersProvider({ children }: { children: ReactNode }) {
  const [sp, setSp] = useSearchParams();

  const [filters, setFiltersState] = useState<ScannerFilters>(() => {
    // Priority: URL > localStorage > defaults
    if (Array.from(sp.keys()).some(k => ["from", "to", "platform", "provider", "game", "streamer", "src", "streamers", "providers"].includes(k))) {
      return readFromUrl(sp, defaultFilters);
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...defaultFilters, ...JSON.parse(raw) };
    } catch {}
    return defaultFilters;
  });

  // Persist to localStorage + URL on change
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(filters)); } catch {}
    const next = writeToUrl(filters, sp);
    if (next.toString() !== sp.toString()) {
      setSp(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const value = useMemo<Ctx>(() => ({
    filters,
    setFilters: setFiltersState,
    patch: (p) => setFiltersState((prev) => ({ ...prev, ...p })),
    reset: () => setFiltersState(defaultFilters),
  }), [filters]);

  return <ScannerFiltersContext.Provider value={value}>{children}</ScannerFiltersContext.Provider>;
}

export function useScannerFilters() {
  const ctx = useContext(ScannerFiltersContext);
  if (!ctx) throw new Error("useScannerFilters must be used inside ScannerFiltersProvider");
  return ctx;
}
