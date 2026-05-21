import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { useLanguage } from "@/contexts/LanguageContext";
import { getReviewQueue, reviewBlock, requestReprocess } from "@/lib/scanner-api";
import { CheckCircle, XCircle, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, string> = {
  suspect: "bg-yellow-500/20 text-yellow-600",
  confirmed: "bg-green-500/20 text-green-600",
  discarded: "bg-destructive/20 text-destructive",
  needs_review: "bg-orange-500/20 text-orange-600",
  partial: "bg-yellow-500/20 text-yellow-600",
  failed: "bg-destructive/20 text-destructive",
};

export function ReviewTab() {
  const { t } = useLanguage();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"suspect" | "vods" | "discarded">("suspect");

  const load = () => {
    setLoading(true);
    getReviewQueue()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleReview = async (blockId: string, status: string) => {
    try {
      await reviewBlock(blockId, status, undefined, undefined);
      toast.success(t("scan.review_saved"));
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleReprocess = async (vodId: string) => {
    try {
      await requestReprocess(vodId);
      toast.success(t("scan.reprocess_queued"));
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground text-center py-8">{t("app.loading")}</p>;
  if (!data) return <p className="text-sm text-muted-foreground text-center py-8">{t("scan.no_data")}</p>;

  const suspectBlocks = data.suspect_blocks || [];
  const problemVods = data.problem_vods || [];
  const recentDiscarded = data.recent_discarded || [];

  return (
    <div className="space-y-4">
      {/* Sub-tab selector */}
      <div className="flex gap-2">
        <Button variant={tab === "suspect" ? "default" : "outline"} size="sm" onClick={() => setTab("suspect")}>
          <AlertTriangle className="h-3.5 w-3.5 mr-1" />
          {t("scan.suspect_blocks")} ({suspectBlocks.length})
        </Button>
        <Button variant={tab === "vods" ? "default" : "outline"} size="sm" onClick={() => setTab("vods")}>
          {t("scan.problem_vods")} ({problemVods.length})
        </Button>
        <Button variant={tab === "discarded" ? "default" : "outline"} size="sm" onClick={() => setTab("discarded")}>
          {t("scan.recent_discarded")} ({recentDiscarded.length})
        </Button>
      </div>

      {/* Suspect Blocks */}
      {tab === "suspect" && (
        <Card className="p-4">
          {suspectBlocks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">{t("scan.no_suspects")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("scan.vod_id")}</TableHead>
                  <TableHead>{t("scan.streamer")}</TableHead>
                  <TableHead>{t("scan.game_col")}</TableHead>
                  <TableHead>{t("scan.provider_col")}</TableHead>
                  <TableHead className="text-right">{t("scan.duration_col")}</TableHead>
                  <TableHead className="text-right">{t("scan.confidence")}</TableHead>
                  <TableHead>{t("scan.reason")}</TableHead>
                  <TableHead className="text-center">{t("scan.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suspectBlocks.map((b: any) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs">{b.vod_id?.slice(0, 12)}</TableCell>
                    <TableCell className="text-sm">{b.streamer_login}</TableCell>
                    <TableCell className="text-sm">{b.game_name || "—"}</TableCell>
                    <TableCell className="text-sm">{b.provider_name || "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {Math.round((b.duration_seconds || 0) / 60)}m
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {Math.round(b.confidence_avg || 0)}%
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">
                      {b.discard_reason || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-center">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleReview(b.id, "confirmed")} title={t("scan.approve")}>
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleReview(b.id, "discarded")} title={t("scan.discard")}>
                          <XCircle className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {/* Problem VODs */}
      {tab === "vods" && (
        <Card className="p-4">
          {problemVods.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">{t("scan.no_problem_vods")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("scan.vod_id")}</TableHead>
                  <TableHead>{t("scan.streamer")}</TableHead>
                  <TableHead>{t("scan.status")}</TableHead>
                  <TableHead className="text-right">{t("scan.coverage")}</TableHead>
                  <TableHead className="text-right">{t("scan.confidence")}</TableHead>
                  <TableHead>{t("scan.quality")}</TableHead>
                  <TableHead className="text-center">{t("scan.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {problemVods.map((v: any) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono text-xs">{v.vod_id}</TableCell>
                    <TableCell className="text-sm">{v.streamer_login}</TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${STATUS_COLORS[v.status] || ""}`}>{v.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {Math.round(v.coverage_percent || 0)}%
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {Math.round(v.confidence_score || 0)}%
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${v.data_quality_status === "good" ? "bg-green-500/20 text-green-600" : v.data_quality_status === "fair" ? "bg-yellow-500/20 text-yellow-600" : "bg-destructive/20 text-destructive"}`}>
                        {v.data_quality_status || "unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleReprocess(v.vod_id)} title={t("scan.reprocess")}>
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {/* Recently Discarded */}
      {tab === "discarded" && (
        <Card className="p-4">
          {recentDiscarded.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">{t("scan.no_discarded")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("scan.vod_id")}</TableHead>
                  <TableHead>{t("scan.game_col")}</TableHead>
                  <TableHead>{t("scan.provider_col")}</TableHead>
                  <TableHead className="text-right">{t("scan.duration_col")}</TableHead>
                  <TableHead className="text-right">{t("scan.confidence")}</TableHead>
                  <TableHead>{t("scan.reason")}</TableHead>
                  <TableHead className="text-center">{t("scan.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentDiscarded.map((b: any) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs">{b.vod_id?.slice(0, 12)}</TableCell>
                    <TableCell className="text-sm">{b.game_name || "—"}</TableCell>
                    <TableCell className="text-sm">{b.provider_name || "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {Math.round((b.duration_seconds || 0) / 60)}m
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {Math.round(b.confidence_avg || 0)}%
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                      {b.discard_reason || "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleReview(b.id, "confirmed")} title={t("scan.restore")}>
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
