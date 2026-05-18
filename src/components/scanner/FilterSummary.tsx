import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useScannerFilters } from "@/contexts/ScannerFiltersContext";
import { getProviders, getGames } from "@/lib/scanner-api";

export function FilterSummary() {
  const { t } = useLanguage();
  const { filters } = useScannerFilters();
  const [providers, setProviders] = useState<any[]>([]);
  const [games, setGames] = useState<any[]>([]);

  useEffect(() => {
    getProviders().then(setProviders).catch(() => {});
    getGames().then(setGames).catch(() => {});
  }, []);

  const chips: { label: string; value: string }[] = [];
  if (filters.date_from || filters.date_to) {
    chips.push({ label: t("scan.from") + "–" + t("scan.to"), value: `${filters.date_from || "—"} → ${filters.date_to || "—"}` });
  }
  if (filters.platform) chips.push({ label: t("scan.platform"), value: filters.platform });
  if (filters.streamers.length) chips.push({ label: t("scan.streamer"), value: filters.streamers.length === 1 ? filters.streamers[0] : `${filters.streamers.length}` });
  else if (filters.streamer) chips.push({ label: t("scan.streamer"), value: filters.streamer });
  if (filters.provider_ids.length) {
    const names = filters.provider_ids.map(id => providers.find(p => p.id === id)?.name || id);
    chips.push({ label: t("scan.provider"), value: names.length <= 2 ? names.join(", ") : `${names.length}` });
  }
  if (filters.game_id) {
    const name = games.find(g => g.id === filters.game_id)?.name || filters.game_id;
    chips.push({ label: t("scan.game"), value: name });
  }
  if (filters.source_type) chips.push({ label: t("scan.source"), value: filters.source_type });

  return (
    <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-md border border-primary/30 bg-primary/5 text-[11px]">
      <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {t("scan.filters_applied")}:
      </span>
      {chips.length === 0 ? (
        <span className="text-muted-foreground italic">{t("scan.no_filters")}</span>
      ) : (
        chips.map((c, i) => (
          <Badge key={i} variant="secondary" className="h-5 text-[10px] font-mono">
            <span className="text-muted-foreground mr-1">{c.label}:</span>
            <span className="text-foreground">{c.value}</span>
          </Badge>
        ))
      )}
    </div>
  );
}
