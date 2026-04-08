import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLanguage } from "@/contexts/LanguageContext";
import { getVodAudits } from "@/lib/scanner-api";
import type { ScannerFilters } from "./GlobalFilters";

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  processing: "bg-primary/20 text-primary",
  partial: "bg-yellow-500/20 text-yellow-600",
  completed: "bg-green-500/20 text-green-600",
  failed: "bg-destructive/20 text-destructive",
  needs_review: "bg-orange-500/20 text-orange-600",
  reprocessed: "bg-blue-500/20 text-blue-600",
};

interface Props {
  filters: ScannerFilters;
}

export function VodQualityTab({ filters }: Props) {
  const { t } = useLanguage();
  const [audits, setAudits] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getVodAudits({ streamer: filters.streamer || undefined })
      .then(setAudits)
      .catch(() => setAudits([]))
      .finally(() => setLoading(false));
  }, [filters.streamer]);

  if (loading) return <p className="text-sm text-muted-foreground text-center py-8">{t("app.loading")}</p>;
  if (audits.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">{t("scan.no_data")}</p>;

  return (
    <Card className="p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("scan.vod_id")}</TableHead>
            <TableHead>{t("scan.streamer")}</TableHead>
            <TableHead>{t("scan.status")}</TableHead>
            <TableHead className="text-right">{t("scan.coverage")}</TableHead>
            <TableHead className="text-right">{t("scan.frames")}</TableHead>
            <TableHead className="text-right">{t("scan.confidence")}</TableHead>
            <TableHead>{t("scan.created")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {audits.map((a: any) => (
            <TableRow key={a.id}>
              <TableCell className="font-mono text-xs">{a.vod_id}</TableCell>
              <TableCell className="text-sm">{a.streamer_login}</TableCell>
              <TableCell>
                <Badge className={`text-[10px] ${STATUS_COLORS[a.status] || ""}`}>{a.status}</Badge>
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                <span className={a.coverage_percent < 90 ? "text-destructive" : "text-green-600"}>
                  {Math.round(a.coverage_percent || 0)}%
                </span>
              </TableCell>
              <TableCell className="text-right text-xs">
                {a.processed_frames}/{a.expected_frames}
                {a.failed_frames > 0 && <span className="text-destructive ml-1">({a.failed_frames} failed)</span>}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">{Math.round(a.confidence_score || 0)}%</TableCell>
              <TableCell className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
