import { useState, useMemo, useEffect, useCallback } from "react";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getUser, getVod, getVods, getVodChapters,
  formatDuration, formatSeconds, parseDuration,
  type TwitchVod, type VodChapter,
} from "@/lib/twitch-api";
import { startWatcher } from "@/lib/vod-watcher";
import { AuditReportCard } from "@/components/AuditReportCard";
import { fmtInt } from "@/lib/formatters";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { VodAuditProgressBar } from "@/components/VodAuditProgressBar";
import { VodAgentReadPanel } from "@/components/scanner/VodAgentReadPanel";
import { useVodAuditProgress } from "@/hooks/useVodAuditProgress";
import { toast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GameSummary {
  game: string;
  gameBoxArt: string | null;
  totalSeconds: number;
  segments: number;
}

interface VodScanState {
  auditId: string | null;
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function aggregateChapters(chapters: VodChapter[]): GameSummary[] {
  const map = new Map<string, GameSummary>();
  for (const ch of chapters) {
    const key = ch.game;
    const existing = map.get(key);
    if (existing) {
      existing.totalSeconds += ch.durationSeconds;
      existing.segments += 1;
    } else {
      map.set(key, { game: ch.game, gameBoxArt: ch.gameBoxArt, totalSeconds: ch.durationSeconds, segments: 1 });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.totalSeconds - a.totalSeconds);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function VodTab() {
  const { t, language } = useLanguage();

  const [vodUrl, setVodUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [vods, setVods] = useState<TwitchVod[]>([]);
  const [singleVod, setSingleVod] = useState<TwitchVod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"single" | "channel" | null>(null);
  const [analysisScope, setAnalysisScope] = useState<"all" | "igaming">("igaming");

  const [chaptersMap, setChaptersMap] = useState<Record<string, VodChapter[]>>({});
  const [loadingChapters, setLoadingChapters] = useState<string | null>(null);
  const [expandedVod, setExpandedVod] = useState<string | null>(null);

  // Per-VOD scan state (replaces global activeAuditId + aiResults)
  const [scanState, setScanState] = useState<Record<string, VodScanState>>({});
  const [existingAudits, setExistingAudits] = useState<Record<string, string>>({});

  const activeScanAuditId = useMemo(() => {
    const entry = Object.entries(scanState).find(([, s]) => s.auditId !== null);
    return entry?.[1].auditId ?? null;
  }, [scanState]);

  const auditProgress = useVodAuditProgress(activeScanAuditId);

  // When any audit transitions to "completed", register it in existingAudits
  useEffect(() => {
    if (
      auditProgress?.progress_phase === "completed" &&
      activeScanAuditId &&
      auditProgress.audit_id
    ) {
      supabase
        .from("vod_audits")
        .select("vod_id")
        .eq("id", auditProgress.audit_id)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.vod_id) {
            setExistingAudits((prev) => ({
              ...prev,
              [data.vod_id]: auditProgress.audit_id,
            }));
          }
        });
    }
  }, [auditProgress?.progress_phase, activeScanAuditId, auditProgress?.audit_id]);

  const fetchExistingAudit = useCallback(async (vodId: string) => {
    if (existingAudits[vodId]) return;
    const { data } = await supabase
      .from("vod_audits")
      .select("id, status")
      .eq("vod_id", vodId)
      .in("status", ["completed", "partial", "needs_review", "reprocessed"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.id) {
      setExistingAudits((prev) => ({ ...prev, [vodId]: data.id }));
    }
  }, [existingAudits]);

  useEffect(() => {
    if (singleVod?.id) void fetchExistingAudit(singleVod.id);
  }, [singleVod?.id]);

  useEffect(() => {
    if (expandedVod) void fetchExistingAudit(expandedVod);
  }, [expandedVod]);

  const analyze = async () => {
    if (!vodUrl.trim()) return;
    setLoading(true);
    setError(null);
    setVods([]);
    setSingleVod(null);
    setMode(null);
    setChaptersMap({});
    setExpandedVod(null);
    setScanState({});
    setExistingAudits({});

    try {
      const input = vodUrl.trim();
      const vodMatch = input.match(/videos\/(\d+)/);
      const isVodId = /^\d+$/.test(input);

      if (vodMatch || isVodId) {
        const vodId = vodMatch ? vodMatch[1] : input;
        const vod = await getVod(vodId);
        if (!vod) throw new Error(t("vod.not_found"));
        setSingleVod(vod);
        setMode("single");

        const chapters = await getVodChapters(vodId);
        setChaptersMap({ [vodId]: chapters });
        setExpandedVod(vodId);

        const channelVods = await getVods(vod.user_id, 20);
        setVods(channelVods);
      } else {
        const login = input
          .replace(/https?:\/\/(www\.|m\.)?twitch\.tv\//, "")
          .replace(/\//g, "")
          .toLowerCase();
        const user = await getUser(login);
        if (!user) throw new Error(t("vod.channel_not_found"));
        const channelVods = await getVods(user.id, 20);
        setVods(channelVods);
        setMode("channel");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    }
    setLoading(false);
  };

  const fetchChapters = async (vodId: string) => {
    if (chaptersMap[vodId]) {
      setExpandedVod(expandedVod === vodId ? null : vodId);
      return;
    }
    setLoadingChapters(vodId);
    try {
      const chapters = await getVodChapters(vodId);
      setChaptersMap((prev) => ({ ...prev, [vodId]: chapters }));
      setExpandedVod(vodId);
    } catch (err) {
      console.error("Chapter fetch error:", err);
    }
    setLoadingChapters(null);
  };

  const analyzeWithAI = async (vod: TwitchVod, isRerun = false) => {
    if (isRerun) {
      const ok = window.confirm(
        "Reler este VOD vai iniciar uma nova auditoria do zero. A leitura anterior continuará no histórico. Deseja continuar?"
      );
      if (!ok) return;
      setExistingAudits((prev) => {
        const next = { ...prev };
        delete next[vod.id];
        return next;
      });
    }

    setScanState((prev) => ({
      ...prev,
      [vod.id]: { auditId: null, loading: true, error: null },
    }));

    try {
      const durationSecs = parseDuration(vod.duration) * 60;
      const result = await startWatcher({
        vodId: vod.id,
        streamerLogin: vod.user_login,
        vodDurationSeconds: Math.round(durationSecs),
        thumbnailUrl: vod.thumbnail_url,
        vodTitle: vod.title,
      });

      setScanState((prev) => ({
        ...prev,
        [vod.id]: { auditId: result.audit_id, loading: false, error: null },
      }));

      if (result.partial_reason) {
        toast({
          title: "⚠ Auditoria iniciada em modo parcial",
          description: `Motivo: ${result.partial_reason}. ${
            result.partial_reason.startsWith("storyboard_")
              ? "A Twitch ainda não disponibilizou storyboards completos para este VOD — tente novamente em alguns minutos para precisão total."
              : "A cobertura está abaixo do ideal — os números podem subestimar o tempo real de cassino."
          }`,
          variant: "destructive",
        });
      } else {
        toast({
          title: isRerun ? "🔄 Releitura iniciada" : "🤖 Agente iniciado em background",
          description: `${result.total_frames} frames serão analisados. Pode fechar a página — o agente continua.`,
        });
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error("Watcher start error:", err);
      setScanState((prev) => ({
        ...prev,
        [vod.id]: { auditId: null, loading: false, error: msg },
      }));
      toast({
        title: "Erro ao iniciar agente",
        description: msg,
        variant: "destructive",
      });
    }
  };

  const allGameSummary = useMemo(() => {
    const allChapters = Object.values(chaptersMap).flat();
    return aggregateChapters(allChapters);
  }, [chaptersMap]);

  const totalViews = vods.reduce((s, v) => s + v.view_count, 0);
  const totalHours = vods.reduce((s, v) => s + parseDuration(v.duration) / 60, 0);
  const avgViewsPerHour = totalHours > 0 ? totalViews / totalHours : 0;

  const downloadExcel = () => {
    const rows: any[][] = [
      ["VOD Analyzer - Relatório"],
      [""],
      ["Resumo", ""],
      ["Total VODs", vods.length],
      ["Total views", totalViews],
      ["Total horas", `${totalHours.toFixed(1)}h`],
      ["Avg views/hora", Math.round(avgViewsPerHour)],
      [""],
      ["VODs", "", "", "", ""],
      ["Título", "Duração", "Views", "Views/h", "Data"],
    ];
    for (const vod of vods) {
      const mins = parseDuration(vod.duration);
      const hours = mins / 60;
      const vph = hours > 0 ? vod.view_count / hours : 0;
      rows.push([
        vod.title,
        formatDuration(vod.duration),
        vod.view_count,
        Math.round(vph),
        new Date(vod.created_at).toLocaleDateString("pt-BR"),
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 40 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 15 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "VODs");
    XLSX.writeFile(wb, "analise-vods.xlsx");
  };

  const analyzeAllVods = async () => {
    for (const vod of vods) {
      if (!chaptersMap[vod.id]) {
        setLoadingChapters(vod.id);
        try {
          const chapters = await getVodChapters(vod.id);
          setChaptersMap((prev) => ({ ...prev, [vod.id]: chapters }));
        } catch (err) {
          console.error("Chapter fetch error for", vod.id, err);
        }
      }
    }
    setLoadingChapters(null);
  };

  const getAuditIdForVod = (vodId: string): string | null =>
    scanState[vodId]?.auditId ?? existingAudits[vodId] ?? null;

  const isVodScanning = (vodId: string): boolean =>
    scanState[vodId]?.loading === true;

  const vodHasAudit = (vodId: string): boolean =>
    getAuditIdForVod(vodId) !== null;

  return (
    <div className="max-w-5xl space-y-4 sm:space-y-6">
      <div className="card-surface p-3 sm:p-4 space-y-1 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <p className="text-xs text-primary font-medium uppercase tracking-wider">{t("vod.title_header")}</p>
          <p className="text-xs sm:text-sm text-muted-foreground">{t("vod.description")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={downloadExcel} className="shrink-0 self-start">
          {t("app.export_excel")}
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <Input
          value={vodUrl}
          onChange={(e) => setVodUrl(e.target.value)}
          placeholder={t("vod.placeholder")}
          className="font-mono bg-secondary border-border text-sm"
          onKeyDown={(e) => e.key === "Enter" && analyze()}
        />
        <Button onClick={analyze} disabled={loading || !vodUrl.trim()} className="shrink-0">
          {loading ? t("vod.analyzing") : t("vod.analyze")}
        </Button>
      </div>

      <div className="card-surface p-2 inline-flex items-center gap-1 self-start">
        <button
          type="button"
          onClick={() => setAnalysisScope("all")}
          className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
            analysisScope === "all"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {language === "pt" ? "Todas as categorias" : "All categories"}
        </button>
        <button
          type="button"
          onClick={() => setAnalysisScope("igaming")}
          className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
            analysisScope === "igaming"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          iGaming
        </button>
        <span className="text-[11px] text-muted-foreground ml-2 pr-2">
          {analysisScope === "igaming"
            ? language === "pt"
              ? "Inclui varredura visual de cassino (IA)"
              : "Includes casino visual AI scan"
            : language === "pt"
              ? "Somente chapters/categorias da Twitch"
              : "Twitch chapters/categories only"}
        </span>
      </div>

      {loading && (
        <div className="card-surface p-6 text-center">
          <div className="inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground mt-2">{t("vod.fetching")}</p>
        </div>
      )}

      {error && (
        <div className="card-surface border-destructive/30 p-4 text-sm text-destructive">{error}</div>
      )}

      {singleVod && mode === "single" && (() => {
        const auditId = getAuditIdForVod(singleVod.id);
        const isScanning = isVodScanning(singleVod.id);
        const scanErr = scanState[singleVod.id]?.error ?? null;
        const showProgress = activeScanAuditId === auditId && auditId !== null;

        return (
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              {t("vod.selected_vod")}
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              <MetricCard
                label="Título"
                value={singleVod.title.slice(0, 40) + (singleVod.title.length > 40 ? "..." : "")}
              />
              <MetricCard label="Duração" value={formatDuration(singleVod.duration)} />
              <MetricCard label="Views" value={fmtInt(singleVod.view_count)} />
              <MetricCard
                label="Views/hora"
                value={fmtInt(
                  parseDuration(singleVod.duration) > 0
                    ? singleVod.view_count / (parseDuration(singleVod.duration) / 60)
                    : 0
                )}
              />
            </div>

            {chaptersMap[singleVod.id] && chaptersMap[singleVod.id].length > 0 && (
              <ChapterDisplay chapters={chaptersMap[singleVod.id]} />
            )}
            {chaptersMap[singleVod.id] && chaptersMap[singleVod.id].length === 0 && (
              <div className="card-surface p-3 text-sm text-muted-foreground">
                {t("vod.no_chapters")}
              </div>
            )}

            {analysisScope === "igaming" && (
              <>
                {!auditId && (
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => analyzeWithAI(singleVod)}
                      disabled={isScanning}
                    >
                      {isScanning ? `🤖 Iniciando agente...` : t("vod.ai_deep_scan")}
                    </Button>
                    <span className="text-xs text-muted-foreground">{t("vod.ai_deep_desc")}</span>
                  </div>
                )}

                {scanErr && (
                  <div className="card-surface border-destructive/30 p-3 text-xs text-destructive">
                    ⚠ Erro ao iniciar scan: {scanErr}
                  </div>
                )}

                {showProgress && auditProgress && (
                  <VodAuditProgressBar progress={auditProgress} />
                )}

                {auditId && (
                  <>
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => analyzeWithAI(singleVod, true)}
                        disabled={isScanning}
                      >
                        {isScanning ? "🔄 Iniciando releitura..." : "🔄 Reler VOD"}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Inicia uma nova auditoria do zero (a anterior fica no histórico).
                      </span>
                    </div>
                    <AuditReportCard auditId={auditId} autoLoad />
                  </>
                )}

                <VodAgentReadPanel vodId={singleVod.id} streamerLogin={singleVod.user_login} />
              </>
            )}
          </div>
        );
      })()}

      {allGameSummary.length > 0 && Object.keys(chaptersMap).length > 1 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            {t("vod.game_summary")}
          </h3>
          <GameSummaryTable games={allGameSummary} />
        </div>
      )}

      {vods.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              {mode === "single" ? t("vod.other_vods") : t("vod.channel_vods")} ({vods.length})
            </h3>
            <Button variant="outline" size="sm" onClick={analyzeAllVods} disabled={!!loadingChapters}>
              {loadingChapters ? t("vod.analyzing") : t("vod.analyze_all")}
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <MetricCard label={t("vod.total_vods")} value={fmtInt(vods.length)} />
            <MetricCard label={t("yt.total_views")} value={fmtInt(totalViews)} />
            <MetricCard label={t("yt.total_hours")} value={`${totalHours.toFixed(1)}h`} />
            <MetricCard
              label={t("vod.avg_views_hour")}
              value={fmtInt(avgViewsPerHour)}
              status={avgViewsPerHour > 100 ? "go" : undefined}
            />
          </div>

          <div className="card-surface overflow-hidden hidden md:block">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-3">{t("yt.title_col")}</th>
                  <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">{t("yt.duration_col")}</th>
                  <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">{t("yt.views_col")}</th>
                  <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Views/h</th>
                  <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">{t("yt.date_col")}</th>
                  <th className="text-center text-xs uppercase tracking-wider text-muted-foreground p-3">{t("vod.games_col")}</th>
                  <th className="text-center text-xs uppercase tracking-wider text-muted-foreground p-3">{t("vod.ia_col")}</th>
                </tr>
              </thead>
              <tbody>
                {vods.map((vod) => {
                  const mins = parseDuration(vod.duration);
                  const hours = mins / 60;
                  const vph = hours > 0 ? vod.view_count / hours : 0;
                  const hasChapters = chaptersMap[vod.id];
                  const isExpanded = expandedVod === vod.id;
                  const auditId = getAuditIdForVod(vod.id);
                  const isScanning = isVodScanning(vod.id);
                  const hasAudit = vodHasAudit(vod.id);
                  const scanErr = scanState[vod.id]?.error ?? null;
                  const showProgress =
                    isExpanded &&
                    activeScanAuditId !== null &&
                    auditId === activeScanAuditId;

                  return (
                    <tr key={vod.id} className="border-b border-border last:border-0">
                      <td colSpan={7} className="p-0">
                        <div
                          className="flex items-center hover:bg-secondary/50 transition-colors cursor-pointer"
                          onClick={() => fetchChapters(vod.id)}
                        >
                          <div className="p-3 text-sm max-w-[250px] truncate flex-1" title={vod.title}>
                            {vod.title}
                          </div>
                          <div className="p-3 text-right font-mono text-sm w-20">{formatDuration(vod.duration)}</div>
                          <div className="p-3 text-right font-mono text-sm w-20">{fmtInt(vod.view_count)}</div>
                          <div className="p-3 text-right font-mono text-sm w-20">{fmtInt(vph)}</div>
                          <div className="p-3 text-right font-mono text-xs text-muted-foreground w-24">
                            {new Date(vod.created_at).toLocaleDateString(
                              language === "pt" ? "pt-BR" : "en-US"
                            )}
                          </div>
                          <div className="p-3 text-center w-16">
                            {loadingChapters === vod.id ? (
                              <div className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            ) : hasChapters ? (
                              <span className="text-xs text-primary">
                                {hasChapters.length > 0 ? `${hasChapters.length}` : "—"}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">🔍</span>
                            )}
                          </div>
                          <div className="p-3 text-center w-16">
                            {analysisScope !== "igaming" ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : isScanning ? (
                              <div className="inline-block w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                            ) : hasAudit ? (
                              <span className="text-xs text-accent">✓</span>
                            ) : (
                              <button
                                className="text-xs text-muted-foreground hover:text-accent transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  analyzeWithAI(vod);
                                }}
                                title="Varredura profunda com IA"
                              >
                                🤖
                              </button>
                            )}
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="px-6 pb-3 space-y-3">
                            {hasChapters && hasChapters.length > 0 && (
                              <ChapterDisplay chapters={hasChapters} compact />
                            )}

                            {showProgress && auditProgress && (
                              <VodAuditProgressBar progress={auditProgress} />
                            )}

                            {scanErr && (
                              <div className="text-xs text-destructive border border-destructive/30 rounded p-2">
                                ⚠ Erro ao iniciar scan: {scanErr}
                              </div>
                            )}

                            {auditId && (
                              <AuditReportCard auditId={auditId} autoLoad />
                            )}

                            <VodAgentReadPanel vodId={vod.id} streamerLogin={vod.user_login} />

                            {!hasAudit && !isScanning && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => analyzeWithAI(vod)}
                                disabled={isScanning}
                              >
                                {t("vod.ai_deep_scan")}
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {vods.map((vod) => {
              const mins = parseDuration(vod.duration);
              const hours = mins / 60;
              const vph = hours > 0 ? vod.view_count / hours : 0;
              const hasChapters = chaptersMap[vod.id];
              const isExpanded = expandedVod === vod.id;
              const auditId = getAuditIdForVod(vod.id);
              const isScanning = isVodScanning(vod.id);
              const hasAudit = vodHasAudit(vod.id);
              const scanErr = scanState[vod.id]?.error ?? null;
              const showProgress =
                isExpanded &&
                activeScanAuditId !== null &&
                auditId === activeScanAuditId;

              return (
                <div
                  key={vod.id}
                  className="card-surface p-3 space-y-2"
                  onClick={() => fetchChapters(vod.id)}
                >
                  <p className="text-sm font-medium truncate">{vod.title}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                    <span>{formatDuration(vod.duration)}</span>
                    <span>{fmtInt(vod.view_count)} views</span>
                    <span>{fmtInt(vph)} v/h</span>
                    <span>
                      {new Date(vod.created_at).toLocaleDateString(
                        language === "pt" ? "pt-BR" : "en-US"
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {loadingChapters === vod.id ? (
                      <div className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    ) : hasChapters ? (
                      <span className="text-xs text-primary">
                        {hasChapters.length > 0 ? `${hasChapters.length} jogos` : "—"}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">🔍 Chapters</span>
                    )}
                    {isScanning ? (
                      <div className="inline-block w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    ) : hasAudit ? (
                      <span className="text-xs text-accent">🤖 ✓</span>
                    ) : (
                      <button
                        className="text-xs text-muted-foreground hover:text-accent"
                        onClick={(e) => {
                          e.stopPropagation();
                          analyzeWithAI(vod);
                        }}
                      >
                        🤖 Scan IA
                      </button>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="pt-2 space-y-2 border-t border-border">
                      {hasChapters && hasChapters.length > 0 && (
                        <ChapterDisplay chapters={hasChapters} compact />
                      )}
                      {showProgress && auditProgress && (
                        <VodAuditProgressBar progress={auditProgress} />
                      )}
                      {scanErr && (
                        <div className="text-xs text-destructive border border-destructive/30 rounded p-2">
                          ⚠ {scanErr}
                        </div>
                      )}
                      {auditId && (
                        <AuditReportCard auditId={auditId} autoLoad />
                      )}
                      <VodAgentReadPanel vodId={vod.id} streamerLogin={vod.user_login} />
                      {!hasAudit && !isScanning && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => analyzeWithAI(vod)}
                        >
                          {t("vod.ai_deep_scan")}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !error && vods.length === 0 && !singleVod && (
        <div className="card-surface p-8 text-center text-muted-foreground text-sm">
          {t("vod.empty")}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ChapterDisplay({ chapters, compact }: { chapters: VodChapter[]; compact?: boolean }) {
  const { t } = useLanguage();
  const games = aggregateChapters(chapters);
  const totalSec = chapters.reduce((s, c) => s + c.durationSeconds, 0);

  return (
    <div className="space-y-2">
      {!compact && (
        <p className="text-xs text-muted-foreground uppercase tracking-wider">
          {t("vod.chapters_twitch")}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {games.map((g) => {
          const pct = totalSec > 0 ? ((g.totalSeconds / totalSec) * 100).toFixed(0) : "0";
          return (
            <div key={g.game} className="flex items-center gap-2 card-surface px-3 py-1.5 text-xs">
              {g.gameBoxArt && (
                <img
                  src={g.gameBoxArt.replace("{width}", "28").replace("{height}", "38")}
                  alt={g.game}
                  className="w-5 h-7 rounded-sm object-cover"
                />
              )}
              <div>
                <span className="font-medium text-foreground">{g.game}</span>
                <span className="text-muted-foreground ml-1.5">
                  {formatSeconds(g.totalSeconds)} ({pct}%)
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {!compact && (
        <div className="card-surface overflow-hidden mt-2">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-2">
                  {t("vod.moment_col")}
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-2">
                  {t("vod.game_category")}
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-2">
                  {t("yt.duration_col")}
                </th>
              </tr>
            </thead>
            <tbody>
              {chapters.map((ch, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="p-2 font-mono text-xs text-muted-foreground">
                    {formatSeconds(ch.positionSeconds)}
                  </td>
                  <td className="p-2 text-sm flex items-center gap-2">
                    {ch.gameBoxArt && (
                      <img
                        src={ch.gameBoxArt.replace("{width}", "20").replace("{height}", "28")}
                        alt={ch.game}
                        className="w-4 h-5 rounded-sm object-cover"
                      />
                    )}
                    {ch.game}
                  </td>
                  <td className="p-2 text-right font-mono text-sm">
                    {formatSeconds(ch.durationSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GameSummaryTable({ games }: { games: GameSummary[] }) {
  const { t } = useLanguage();
  const totalSec = games.reduce((s, g) => s + g.totalSeconds, 0);
  return (
    <div className="card-surface overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-3">
              {t("vod.game_col")}
            </th>
            <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">
              {t("vod.total_time")}
            </th>
            <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">%</th>
            <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">
              {t("vod.segments_col")}
            </th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => (
            <tr
              key={g.game}
              className="border-b border-border last:border-0 hover:bg-secondary/50 transition-colors"
            >
              <td className="p-3 text-sm flex items-center gap-2">
                {g.gameBoxArt && (
                  <img
                    src={g.gameBoxArt.replace("{width}", "28").replace("{height}", "38")}
                    alt={g.game}
                    className="w-5 h-7 rounded-sm object-cover"
                  />
                )}
                {g.game}
              </td>
              <td className="p-3 text-right font-mono text-sm">{formatSeconds(g.totalSeconds)}</td>
              <td className="p-3 text-right font-mono text-sm">
                {totalSec > 0 ? ((g.totalSeconds / totalSec) * 100).toFixed(1) : 0}%
              </td>
              <td className="p-3 text-right font-mono text-sm">{g.segments}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
