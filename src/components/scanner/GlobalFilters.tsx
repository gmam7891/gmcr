import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getProviders, getGames } from "@/lib/scanner-api";
import { supabase } from "@/integrations/supabase/client";
import { Filter, X, ChevronDown } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useScannerFilters, defaultFilters, ScannerFilters } from "@/contexts/ScannerFiltersContext";

// Re-export so existing imports keep working
export type { ScannerFilters } from "@/contexts/ScannerFiltersContext";
export { defaultFilters } from "@/contexts/ScannerFiltersContext";

export function GlobalFilters() {
  const { t } = useLanguage();
  const { filters, patch, reset } = useScannerFilters();
  const [providers, setProviders] = useState<any[]>([]);
  const [games, setGames] = useState<any[]>([]);
  const [streamers, setStreamers] = useState<{ login: string; display_name: string | null }[]>([]);

  useEffect(() => {
    getProviders().then(setProviders);
    supabase
      .from("monitored_streamers")
      .select("login, display_name")
      .order("login")
      .then(({ data }) => setStreamers(data || []));
  }, []);

  useEffect(() => {
    getGames(filters.provider_id || undefined).then(setGames);
  }, [filters.provider_id]);

  const update = (key: keyof ScannerFilters, val: string) => {
    const next: Partial<ScannerFilters> = { [key]: val };
    if (key === "provider_id") next.game_id = "";
    patch(next);
  };

  const toggleArr = (key: "streamers" | "provider_ids", val: string) => {
    const cur = filters[key];
    const next = cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val];
    patch({ [key]: next } as Partial<ScannerFilters>);
  };

  return (
    <div className="flex flex-wrap gap-2 items-end p-2 bg-secondary/30 rounded-md border border-border">
      <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1.5" />

      <div className="space-y-0.5">
        <label className="text-[9px] text-muted-foreground uppercase font-mono tracking-wider">{t("scan.from")}</label>
        <Input type="date" value={filters.date_from} onChange={e => update("date_from", e.target.value)} className="h-7 w-32 text-[11px]" />
      </div>
      <div className="space-y-0.5">
        <label className="text-[9px] text-muted-foreground uppercase font-mono tracking-wider">{t("scan.to")}</label>
        <Input type="date" value={filters.date_to} onChange={e => update("date_to", e.target.value)} className="h-7 w-32 text-[11px]" />
      </div>

      <div className="space-y-0.5">
        <label className="text-[9px] text-muted-foreground uppercase font-mono tracking-wider">{t("scan.platform")}</label>
        <Select value={filters.platform || "all"} onValueChange={v => update("platform", v === "all" ? "" : v)}>
          <SelectTrigger className="h-7 w-24 text-[11px]"><SelectValue placeholder={t("app.all")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("app.all")}</SelectItem>
            <SelectItem value="twitch">Twitch</SelectItem>
            <SelectItem value="youtube">YouTube</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Multi-select Streamers */}
      <div className="space-y-0.5">
        <label className="text-[9px] text-muted-foreground uppercase font-mono tracking-wider">{t("scan.streamer")}</label>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-7 w-36 text-[11px] justify-between font-normal">
              <span className="truncate">
                {filters.streamers.length === 0 ? t("app.all") : filters.streamers.length === 1 ? filters.streamers[0] : `${filters.streamers.length} sel.`}
              </span>
              <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="start">
            <ScrollArea className="h-56">
              <div className="p-1.5 space-y-0.5">
                {streamers.length === 0 && <p className="text-[10px] text-muted-foreground p-2">—</p>}
                {streamers.map(s => (
                  <label key={s.login} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-secondary cursor-pointer text-[11px]">
                    <Checkbox checked={filters.streamers.includes(s.login)} onCheckedChange={() => toggleArr("streamers", s.login)} />
                    <span className="truncate">{s.display_name || s.login}</span>
                  </label>
                ))}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>

      {/* Multi-select Providers */}
      <div className="space-y-0.5">
        <label className="text-[9px] text-muted-foreground uppercase font-mono tracking-wider">{t("scan.provider")}</label>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-7 w-36 text-[11px] justify-between font-normal">
              <span className="truncate">
                {filters.provider_ids.length === 0 ? t("app.all") : filters.provider_ids.length === 1 ? (providers.find(p => p.id === filters.provider_ids[0])?.name || "1") : `${filters.provider_ids.length} sel.`}
              </span>
              <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="start">
            <ScrollArea className="h-56">
              <div className="p-1.5 space-y-0.5">
                {providers.map((p: any) => (
                  <label key={p.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-secondary cursor-pointer text-[11px]">
                    <Checkbox checked={filters.provider_ids.includes(p.id)} onCheckedChange={() => toggleArr("provider_ids", p.id)} />
                    <span className="truncate">{p.name}</span>
                  </label>
                ))}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>

      <div className="space-y-0.5">
        <label className="text-[9px] text-muted-foreground uppercase font-mono tracking-wider">{t("scan.game")}</label>
        <Select value={filters.game_id || "all"} onValueChange={v => update("game_id", v === "all" ? "" : v)}>
          <SelectTrigger className="h-7 w-32 text-[11px]"><SelectValue placeholder={t("app.all")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("app.all")}</SelectItem>
            {games.map((g: any) => (
              <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-0.5">
        <label className="text-[9px] text-muted-foreground uppercase font-mono tracking-wider">{t("scan.source")}</label>
        <Select value={filters.source_type || "all"} onValueChange={v => update("source_type", v === "all" ? "" : v)}>
          <SelectTrigger className="h-7 w-20 text-[11px]"><SelectValue placeholder={t("app.all")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("app.all")}</SelectItem>
            <SelectItem value="live">Live</SelectItem>
            <SelectItem value="vod">VOD</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(filters.streamers.length + filters.provider_ids.length) > 0 && (
        <div className="flex items-center gap-1 self-end pb-1">
          {filters.streamers.length > 0 && <Badge variant="secondary" className="h-5 text-[9px] font-mono">{filters.streamers.length} streamer(s)</Badge>}
          {filters.provider_ids.length > 0 && <Badge variant="secondary" className="h-5 text-[9px] font-mono">{filters.provider_ids.length} prov.</Badge>}
        </div>
      )}

      <Button variant="ghost" size="sm" onClick={reset} className="h-7 text-[11px] px-2">
        <X className="h-3 w-3 mr-1" />{t("scan.clear")}
      </Button>
    </div>
  );
}
