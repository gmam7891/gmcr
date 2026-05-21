import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLanguage } from "@/contexts/LanguageContext";
import { getVodAuditDetail, getVodAudits, getQualityMetrics } from "@/lib/scanner-api";
import { MetricCard } from "@/components/MetricCard";
import { ChevronDown, ChevronUp } from "lucide-react";
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

const QUALITY_COLORS: Record<string, string> = {
  good: "bg-green-500/20 text-green-600",
  fair: "bg-yellow-500/20 text-yellow-600",
  poor: "bg-destructive/20 text-destructive",
  unknown: "bg-muted text-muted-foreground",
};

interface Props {
  filters: ScannerFilters;
}

export function AuditTab({ filters }: Props) {
  const { t } = useLanguage();
  const [audits, setAudits] = useState<any[]>([]);
  const [quality, setQuality] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [expandedVod, setExpandedVod] = useState<string | null>(null);
  const [vodDetail, setVodDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getVodAudits({ streamer: filters.streamer || undefined }),
      getQualityMetrics(),
    ]).then(([a, q]) => {
      setAudits(a);
      setQuality(q);
    }).catch(() => {
      setAudits([]);
      setQuality(null);
    }).finally(() => setLoading(false));
  }, [filters.streamer]);

  const loadDetail = async (vodId: string) => {
    if (expandedVod === vodId) {
      setExpandedVod(null);
      return;
    }
    setExpandedVod(vodId);
    setDetailLoading(true);
    try {
      const detail = await getVodAuditDetail(vodId);
      setVodDetail(detail);
    } catch {
      setVodDetail(null);
    }
    setDetailLoading(false);
  };

  if (loading) return <p className="text-sm text-muted-foreground text-center py-8">{t("app.loading")}</p>;

  return (
    <div className="space-y-4">
      {/* Quality Metrics */}
      {quality && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <MetricCard label={t("scan.confirmed_blocks_total")} value={quality.confirmed_blocks || 0} />
          <MetricCard label={t("scan.suspect_blocks_total")} value={quality.suspect_blocks || 0} />
          <MetricCard label={t("scan.false_positive_rate")} value={`${(quality.false_positive_rate || 0).toFixed(1)}%`} />
          <MetricCard label={t("scan.avg_coverage_quality")} value={`${Math.round(quality.avg_coverage || 0)}%`} />
          <MetricCard label={t("scan.avg_confidence_quality")} value={`${(() => { const v = quality.avg_confidence || 0; return v <= 1 ? Math.round(v * 100) : Math.round(v); })()}%`} />
        </div>
      )}

      {/* VOD Audit List */}
      {audits.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">{t("scan.no_data")}</p>
      ) : (
        <Card className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>{t("scan.vod_id")}</TableHead>
                <TableHead>{t("scan.streamer")}</TableHead>
                <TableHead>{t("scan.status")}</TableHead>
                <TableHead>{t("scan.quality")}</TableHead>
                <TableHead className="text-right">{t("scan.coverage")}</TableHead>
                <TableHead className="text-right">{t("scan.confidence")}</TableHead>
                <TableHead className="text-right">{t("scan.evidences")}</TableHead>
                <TableHead className="text-right">{t("scan.blocks_count")}</TableHead>
                <TableHead>{t("scan.created")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audits.map((a: any) => (
                <>
                  <TableRow key={a.id} className="cursor-pointer hover:bg-secondary/50" onClick={() => loadDetail(a.vod_id)}>
                    <TableCell>
                      {expandedVod === a.vod_id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{a.vod_id}</TableCell>
                    <TableCell className="text-sm">{a.streamer_login}</TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${STATUS_COLORS[a.status] || ""}`}>{a.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${QUALITY_COLORS[a.data_quality_status || "unknown"]}`}>
                        {a.data_quality_status || "unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      <span className={(a.coverage_percent || 0) < 90 ? "text-destructive" : "text-green-600"}>
                        {Math.round(a.coverage_percent || 0)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {(() => {
                        const raw = a.confidence_score || 0;
                        // Handle both 0-1 (old) and 0-100 (new) formats
                        const pct = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
                        return `${pct}%`;
                      })()}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {a.valid_evidences || 0}/{a.total_evidences || 0}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      <span className="text-green-600">{a.confirmed_blocks || 0}</span>
                      {(a.suspect_blocks || 0) > 0 && <span className="text-yellow-600 ml-1">+{a.suspect_blocks}</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>

                  {/* Expanded detail */}
                  {expandedVod === a.vod_id && (
                    <TableRow key={`${a.id}-detail`}>
                      <TableCell colSpan={10} className="p-0">
                        {detailLoading ? (
                          <p className="text-sm text-muted-foreground text-center py-4">{t("app.loading")}</p>
                        ) : vodDetail ? (
                          <VodDetailPanel detail={vodDetail} />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function VodDetailPanel({ detail }: { detail: any }) {
  const { t } = useLanguage();
  const blocks = detail.blocks || [];
  const logs = detail.logs || [];
  const evidenceSummary = detail.evidence_summary || {};



  return (
    <div className="bg-secondary/30 p-4 space-y-4 border-t border-border">
      {/* Evidence Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <p className="text-xs text-muted-foreground">{t("scan.total_evidences")}</p>
          <p className="text-lg font-mono font-semibold">{evidenceSummary.total || 0}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">{t("scan.valid_evidences")}</p>
          <p className="text-lg font-mono font-semibold text-green-600">{evidenceSummary.valid || 0}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">{t("scan.discarded_evidences")}</p>
          <p className="text-lg font-mono font-semibold text-destructive">{evidenceSummary.discarded || 0}</p>
        </div>
      </div>

      {/* Gameplay Blocks */}
      {blocks.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">{t("scan.gameplay_blocks_title")}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("scan.game_col")}</TableHead>
                <TableHead>{t("scan.provider_col")}</TableHead>
                <TableHead>{t("scan.status")}</TableHead>
                <TableHead className="text-right">{t("scan.start_sec")}</TableHead>
                <TableHead className="text-right">{t("scan.end_sec")}</TableHead>
                <TableHead className="text-right">{t("scan.duration_col")}</TableHead>
                <TableHead className="text-right">{t("scan.hits")}</TableHead>
                <TableHead className="text-right">{t("scan.confidence")}</TableHead>
                <TableHead>{t("scan.reason")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {blocks.map((b: any) => (
                <TableRow key={b.id}>
                  <TableCell className="text-sm">{b.game_name || "—"}</TableCell>
                  <TableCell className="text-sm">{b.provider_name || "—"}</TableCell>
                  <TableCell>
                    <Badge className={`text-[10px] ${b.status === "confirmed" ? "bg-green-500/20 text-green-600" : b.status === "suspect" ? "bg-yellow-500/20 text-yellow-600" : "bg-destructive/20 text-destructive"}`}>
                      {b.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatSec(b.start_seconds)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatSec(b.end_seconds)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{Math.round(b.duration_seconds / 60)}m</TableCell>
                  <TableCell className="text-right text-xs">{b.evidence_count}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {(() => {
                      const avg = b.confidence_avg || 0;
                      const min = b.confidence_min || 0;
                      const max = b.confidence_max || 0;
                      const fmt = (v: number) => v <= 1 ? Math.round(v * 100) : Math.round(v);
                      return <>{fmt(avg)}%<span className="text-muted-foreground ml-1">({fmt(min)}-{fmt(max)})</span></>;
                    })()}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{b.discard_reason || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Audit Logs */}
      {logs.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">{t("scan.audit_log")}</p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {logs.map((log: any) => (
              <div key={log.id} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">{new Date(log.created_at).toLocaleString()}</span>
                <Badge variant="outline" className="text-[9px]">{log.action}</Badge>
                <span className="text-muted-foreground truncate max-w-[300px]">
                  {JSON.stringify(log.details).slice(0, 100)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatSec(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
