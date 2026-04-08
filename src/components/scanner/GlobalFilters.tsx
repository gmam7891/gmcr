import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getProviders, getGames } from "@/lib/scanner-api";
import { Filter, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

export interface ScannerFilters {
  date_from: string;
  date_to: string;
  platform: string;
  provider_id: string;
  game_id: string;
  streamer: string;
  source_type: string;
}

const defaultFilters: ScannerFilters = {
  date_from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
  date_to: new Date().toISOString().slice(0, 10),
  platform: "",
  provider_id: "",
  game_id: "",
  streamer: "",
  source_type: "",
};

interface Props {
  filters: ScannerFilters;
  onChange: (f: ScannerFilters) => void;
}

export function GlobalFilters({ filters, onChange }: Props) {
  const { t } = useLanguage();
  const [providers, setProviders] = useState<any[]>([]);
  const [games, setGames] = useState<any[]>([]);

  useEffect(() => {
    getProviders().then(setProviders);
  }, []);

  useEffect(() => {
    getGames(filters.provider_id || undefined).then(setGames);
  }, [filters.provider_id]);

  const update = (key: keyof ScannerFilters, val: string) => {
    const next = { ...filters, [key]: val };
    if (key === "provider_id") next.game_id = "";
    onChange(next);
  };

  return (
    <div className="flex flex-wrap gap-2 items-end p-3 bg-secondary/30 rounded-lg border border-border">
      <Filter className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
      
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground uppercase font-mono">{t("scan.from")}</label>
        <Input type="date" value={filters.date_from} onChange={e => update("date_from", e.target.value)} className="h-8 w-32 text-xs" />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground uppercase font-mono">{t("scan.to")}</label>
        <Input type="date" value={filters.date_to} onChange={e => update("date_to", e.target.value)} className="h-8 w-32 text-xs" />
      </div>
      
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground uppercase font-mono">{t("scan.platform")}</label>
        <Select value={filters.platform} onValueChange={v => update("platform", v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder={t("app.all")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("app.all")}</SelectItem>
            <SelectItem value="twitch">Twitch</SelectItem>
            <SelectItem value="youtube">YouTube</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground uppercase font-mono">{t("scan.provider")}</label>
        <Select value={filters.provider_id} onValueChange={v => update("provider_id", v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder={t("app.all")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("app.all")}</SelectItem>
            {providers.map((p: any) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground uppercase font-mono">{t("scan.game")}</label>
        <Select value={filters.game_id} onValueChange={v => update("game_id", v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder={t("app.all")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("app.all")}</SelectItem>
            {games.map((g: any) => (
              <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground uppercase font-mono">{t("scan.streamer")}</label>
        <Input value={filters.streamer} onChange={e => update("streamer", e.target.value)} placeholder={t("app.all")} className="h-8 w-28 text-xs" />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground uppercase font-mono">{t("scan.source")}</label>
        <Select value={filters.source_type} onValueChange={v => update("source_type", v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 w-24 text-xs"><SelectValue placeholder={t("app.all")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("app.all")}</SelectItem>
            <SelectItem value="live">Live</SelectItem>
            <SelectItem value="vod">VOD</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button variant="ghost" size="sm" onClick={() => onChange(defaultFilters)} className="h-8 text-xs">
        <X className="h-3 w-3 mr-1" />{t("scan.clear")}
      </Button>
    </div>
  );
}

export { defaultFilters };
