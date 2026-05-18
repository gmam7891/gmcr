import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLanguage } from "@/contexts/LanguageContext";
import { useScannerRankings } from "@/hooks/useScannerQueries";
import { TableSkeleton } from "./skeletons";
import { FilterSummary } from "./FilterSummary";
import type { ScannerFilters } from "@/contexts/ScannerFiltersContext";

interface Props {
  filters: ScannerFilters;
  rankBy: "streamer" | "provider" | "game";
}

export function RankingsTab({ filters, rankBy }: Props) {
  const { t } = useLanguage();
  const { data, isLoading } = useScannerRankings(filters, rankBy);
  const rankings = data?.rankings || [];

  if (isLoading) return <TableSkeleton rows={10} cols={6} />;
  if (rankings.length === 0) return <p className="text-[11px] text-muted-foreground text-center py-8 leading-tight">{t("scan.no_data")}</p>;

  return (
    <Card className="p-2.5">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-[11px] h-7">#</TableHead>
            <TableHead className="text-[11px] h-7">{rankBy === "streamer" ? t("scan.streamer") : rankBy === "provider" ? t("scan.provider") : t("scan.game")}</TableHead>
            <TableHead className="text-right text-[11px] h-7">{t("scan.exposure")}</TableHead>
            <TableHead className="text-right text-[11px] h-7">{t("scan.total_viewer_min")}</TableHead>
            <TableHead className="text-right text-[11px] h-7">{t("scan.sessions")}</TableHead>
            <TableHead className="text-right text-[11px] h-7">{t("scan.peak")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rankings.map((r: any, i: number) => (
            <TableRow key={r.key} className="leading-tight">
              <TableCell className="font-mono text-[11px] py-1.5">{i + 1}</TableCell>
              <TableCell className="font-medium text-[12px] py-1.5">{r.key || '—'}</TableCell>
              <TableCell className="text-right font-mono text-[11px] py-1.5">{Math.round((r.exposure ?? 0) / 3600 * 10) / 10}h</TableCell>
              <TableCell className="text-right font-mono text-[11px] py-1.5">{(r.viewer_minutes ?? 0).toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono text-[11px] py-1.5">{r.sessions ?? 0}</TableCell>
              <TableCell className="text-right font-mono text-[11px] py-1.5">{(r.peak ?? 0).toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
