import { useState, useMemo } from "react";
import { MetricCard } from "@/components/MetricCard";
import { NumberField, FieldSection } from "@/components/FieldGroup";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtMoney, fmtInt, fmtPercent } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import * as XLSX from "xlsx";
import {
  getYouTubeChannel, getYouTubeVideos, analyzeThumbnails, formatYTDuration,
  type YouTubeChannel, type YouTubeVideo, type GameDetection,
} from "@/lib/youtube-kick-api";

export function YouTubeTab() {
  const { t, language } = useLanguage();
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);
  const [channel, setChannel] = useState<YouTubeChannel | null>(null);
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);

  // Financial inputs
  const [fee, setFee] = useState(0);
  const [ctr, setCtr] = useState(0);
  const [cvr, setCvr] = useState(0);
  const [valueFtd, setValueFtd] = useState(0);
  const [percIcp, setPercIcp] = useState(0);

  // AI analysis
  const [aiGames, setAiGames] = useState<GameDetection[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  const fetchChannel = async () => {
    if (!handle.trim()) return;
    setLoading(true);
    try {
      const ch = await getYouTubeChannel(handle.trim());
      setChannel(ch);
      const vids = await getYouTubeVideos(ch.id);
      setVideos(vids);
      toast.success(`${ch.title} — ${t("yt.channel_loaded")}`, {
        description: `${fmtInt(ch.subscriberCount)} ${t("yt.subscribers")} · ${fmtInt(ch.videoCount)} ${t("yt.videos")}`,
      });
    } catch (err: any) {
      toast.error(t("yt.error_channel"), { description: err.message });
    }
    setLoading(false);
  };

  const analyzeWithAI = async () => {
    if (videos.length === 0) return;
    setAiLoading(true);
    try {
      const thumbs = videos.slice(0, 15).map(v => v.thumbnailUrl).filter(Boolean);
      const games = await analyzeThumbnails(thumbs, channel?.title || '', 'YouTube');
      setAiGames(games);
      toast.success(`${games.filter(g => g.category !== 'not_casino').length} jogos detectados`);
    } catch (err: any) {
      toast.error(t("yt.error_ai"), { description: err.message });
    }
    setAiLoading(false);
  };

  const totalViews = videos.reduce((s, v) => s + v.viewCount, 0);
  const totalMinutes = videos.reduce((s, v) => s + v.durationMinutes, 0);
  const totalHours = totalMinutes / 60;
  const avgViews = videos.length > 0 ? totalViews / videos.length : 0;
  const avgViewsPerHour = totalHours > 0 ? totalViews / totalHours : 0;

  const results = useMemo(() => {
    const icpFactor = percIcp / 100;
    const viewsIcp = totalViews * icpFactor;
    const clicks = viewsIcp * (ctr / 100);
    const ftd = clicks * (cvr / 100);
    const revenue = ftd * valueFtd;
    const roi = fee > 0 ? ((revenue - fee) / fee) * 100 : 0;
    const cpa = ftd > 0 ? fee / ftd : null;
    const profit = revenue - fee;
    return { viewsIcp, clicks, ftd, revenue, roi, cpa, profit };
  }, [totalViews, percIcp, ctr, cvr, valueFtd, fee]);

  const downloadExcel = () => {
    const data: any[][] = [
      ["YouTube - Relatório"],
      [""],
      ["Canal", channel?.title || handle],
      ["Inscritos", channel?.subscriberCount || 0],
      ["Total vídeos", channel?.videoCount || 0],
      [""],
      ["Últimos vídeos analisados", videos.length],
      ["Views totais", totalViews],
      ["Avg views/vídeo", Math.round(avgViews)],
      ["Total horas", `${totalHours.toFixed(1)}h`],
      [""],
      ["% ICP", `${percIcp}%`],
      ["CTR", `${ctr}%`],
      ["CVR para FTD", `${cvr}%`],
      ["Valor por FTD", valueFtd],
      ["Fee", fee],
      [""],
      ["Views ICP", Math.round(results.viewsIcp)],
      ["Cliques", Math.round(results.clicks)],
      ["FTD", Math.round(results.ftd)],
      ["Receita", results.revenue],
      ["ROI", `${results.roi.toFixed(1)}%`],
      ["CPA", results.cpa],
      ["Lucro", results.profit],
      [""],
      ["--- Vídeos ---"],
      ["Título", "Views", "Duração", "Data"],
    ];
    for (const v of videos) {
      data.push([v.title, v.viewCount, formatYTDuration(v.duration), new Date(v.publishedAt).toLocaleDateString("pt-BR")]);
    }
    if (aiGames.length > 0) {
      data.push([""], ["--- Jogos detectados (IA) ---"], ["Jogo", "Provedora", "Categoria", "Confiança"]);
      for (const g of aiGames) data.push([g.game, g.provider || "-", g.category, g.confidence]);
    }
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 40 }, { wch: 15 }, { wch: 12 }, { wch: 15 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "YouTube");
    XLSX.writeFile(wb, `analise-youtube-${handle || 'canal'}.xlsx`);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <FieldSection title={t("yt.search_channel")}>
          <div className="flex gap-2">
            <Input
              placeholder={t("yt.handle_placeholder")}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchChannel()}
              className="font-mono"
            />
            <Button onClick={fetchChannel} disabled={loading} size="sm" className="shrink-0">
              {loading ? t("app.searching") : t("app.search")}
            </Button>
          </div>
          {channel && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50 border border-border mt-2">
              {channel.thumbnailUrl && (
                <img src={channel.thumbnailUrl} alt={channel.title} className="w-10 h-10 rounded-full" />
              )}
              <div className="flex-1 min-w-0">
                <span className="font-medium text-sm truncate block">{channel.title}</span>
                <span className="text-xs text-muted-foreground">
                  {fmtInt(channel.subscriberCount)} {t("yt.subscribers")} · {fmtInt(channel.videoCount)} {t("yt.videos")}
                </span>
              </div>
            </div>
          )}
        </FieldSection>

        <FieldSection title={t("yt.financial_projection")}>
          <NumberField label={t("yt.icp_pct")} value={percIcp} onChange={setPercIcp} step={1} max={100} suffix="%" />
          <NumberField label="CTR" value={ctr} onChange={setCtr} step={0.1} suffix="%" />
          <NumberField label={t("tw.cvr_ftd")} value={cvr} onChange={setCvr} step={0.1} suffix="%" />
          <NumberField label={t("tw.value_per_ftd")} value={valueFtd} onChange={setValueFtd} step={50} suffix="R$" />
          <NumberField label={t("tw.fee")} value={fee} onChange={setFee} step={1000} suffix="R$" />
        </FieldSection>
      </div>

      <div className="lg:col-span-3 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{t("app.results")}</h2>
          <Button variant="outline" size="sm" onClick={downloadExcel}>{t("app.export_excel")}</Button>
        </div>

        {videos.length > 0 && (
          <>
            <div className="grid grid-cols-4 gap-3">
              <MetricCard label={t("yt.analyzed_videos")} value={fmtInt(videos.length)} />
              <MetricCard label={t("yt.total_views")} value={fmtInt(totalViews)} />
              <MetricCard label={t("yt.avg_views_video")} value={fmtInt(avgViews)} />
              <MetricCard label={t("yt.total_hours")} value={`${totalHours.toFixed(1)}h`} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <MetricCard label={t("yt.views_icp")} value={fmtInt(results.viewsIcp)} />
              <MetricCard label={t("tw.estimated_clicks")} value={fmtInt(results.clicks)} />
              <MetricCard label={t("tw.projected_ftd")} value={fmtInt(results.ftd)} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <MetricCard label="Receita projetada" value={fmtMoney(results.revenue)} status={results.revenue > 0 ? "go" : undefined} />
              <MetricCard label="ROI" value={fee > 0 ? fmtPercent(results.roi, 0) : "-"} status={fee > 0 ? (results.roi >= 200 ? "go" : results.roi >= 0 ? "warning" : "nogo") : undefined} />
              <MetricCard label="Lucro / Prejuízo" value={fee > 0 ? fmtMoney(results.profit) : "-"} status={fee > 0 ? (results.profit > 0 ? "go" : results.profit < 0 ? "nogo" : undefined) : undefined} />
            </div>
            {fee > 0 && <StatusBadge status={results.profit > 0 ? "go" : results.profit === 0 ? "warning" : "nogo"} />}

            {/* AI Analysis */}
            <div className="flex items-center gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={analyzeWithAI} disabled={aiLoading}>
                {aiLoading ? "🤖 Analisando..." : "🤖 Detectar jogos com IA"}
              </Button>
              <span className="text-xs text-muted-foreground">Analisa thumbnails dos vídeos</span>
            </div>

            {aiGames.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-accent font-medium uppercase tracking-wider">Jogos detectados</p>
                <div className="flex flex-wrap gap-1.5">
                  {aiGames.filter(g => g.category !== 'not_casino').map((g, i) => (
                    <div key={i} className="flex items-center gap-2 card-surface px-3 py-1.5 text-xs border border-accent/20">
                      <span className="text-accent">🎰</span>
                      <span className="font-medium text-foreground">{g.game}</span>
                      {g.provider && <span className="text-muted-foreground">({g.provider})</span>}
                    </div>
                  ))}
                  {aiGames.filter(g => g.category === 'not_casino').map((g, i) => (
                    <div key={`o-${i}`} className="flex items-center gap-2 card-surface px-3 py-1.5 text-xs">
                      <span>🎮</span>
                      <span className="text-muted-foreground">{g.game}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Video list */}
            <div className="card-surface overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-3">Título</th>
                    <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Duração</th>
                    <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Views</th>
                    <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.map((v) => (
                    <tr key={v.id} className="border-b border-border last:border-0 hover:bg-secondary/50 transition-colors">
                      <td className="p-3 text-sm max-w-[300px] truncate" title={v.title}>{v.title}</td>
                      <td className="p-3 text-right font-mono text-sm">{formatYTDuration(v.duration)}</td>
                      <td className="p-3 text-right font-mono text-sm">{fmtInt(v.viewCount)}</td>
                      <td className="p-3 text-right font-mono text-xs text-muted-foreground">
                        {new Date(v.publishedAt).toLocaleDateString("pt-BR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!loading && videos.length === 0 && !channel && (
          <div className="card-surface p-8 text-center text-muted-foreground text-sm">
            Busque um canal do YouTube para iniciar a análise.
          </div>
        )}
      </div>
    </div>
  );
}
