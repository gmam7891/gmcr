import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLanguage } from "@/contexts/LanguageContext";
import { getRankings } from "@/lib/scanner-api";
import type { ScannerFilters } from "./GlobalFilters";

interface Props {
  filters: ScannerFilters;
  rankBy: "streamer" | "provider" | "game";
}

export function RankingsTab({ filters, rankBy }: Props) {
  const { t } = useLanguage();
  const [rankings, setRankings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getRankings({ date_from: filters.date_from, date_to: filters.date_to, rank_by: rankBy })
      .then(d => setRankings(d.rankings || []))
      .catch(() => setRankings([]))
      .finally(() => setLoading(false));
  }, [filters.date_from, filters.date_to, rankBy]);

  if (loading) return <p className="text-sm text-muted-foreground text-center py-8">{t("app.loading")}</p>;
  if (rankings.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">{t("scan.no_data")}</p>;

  return (
    <Card className="p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>{rankBy === "streamer" ? t("scan.streamer") : rankBy === "provider" ? t("scan.provider") : t("scan.game")}</TableHead>
            <TableHead className="text-right">{t("scan.exposure")}</TableHead>
            <TableHead className="text-right">{t("scan.total_viewer_min")}</TableHead>
            <TableHead className="text-right">{t("scan.sessions")}</TableHead>
            <TableHead className="text-right">{t("scan.peak")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rankings.map((r, i) => (
            <TableRow key={r.key}>
              <TableCell className="font-mono text-xs">{i + 1}</TableCell>
              <TableCell className="font-medium text-sm">{r.key || '—'}</TableCell>
              <TableCell className="text-right font-mono text-xs">{Math.round((r.exposure ?? 0) / 3600 * 10) / 10}h</TableCell>
              <TableCell className="text-right font-mono text-xs">{(r.viewer_minutes ?? 0).toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono text-xs">{r.sessions ?? 0}</TableCell>
              <TableCell className="text-right font-mono text-xs">{(r.peak ?? 0).toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
