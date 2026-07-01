import { useState } from "react";
import { MetricCard } from "@/components/MetricCard";
import { FieldSection } from "@/components/FieldGroup";
import { fmtMoney, fmtInt } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { PlatformCampaignSection } from "@/components/platform/PlatformCampaignSection";
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
  const platformReach = totalViews;

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

            <div className="flex items-center gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={analyzeWithAI} disabled={aiLoading}>
                {aiLoading ? t("yt.ai_analyzing") : t("yt.ai_detect")}
              </Button>
              <span className="text-xs text-muted-foreground">{t("yt.ai_analyzes_thumbs")}</span>
            </div>

            {aiGames.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-accent font-medium uppercase tracking-wider">{t("yt.games_detected")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {aiGames.filter(g => g.category !== 'not_casino').map((g, i) => (
                    <div key={i} className="flex items-center gap-2 card-surface px-3 py-1.5 text-xs border border-accent/20">
                      <span className="text-accent">🎰</span>
                      <span className="font-medium text-foreground">{g.game}</span>
                      {g.provider && <span className="text-muted-foreground">({g.provider})</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="card-surface overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                     <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-3">{t("yt.title_col")}</th>
                     <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">{t("yt.duration_col")}</th>
                     <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">{t("yt.views_col")}</th>
                     <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">{t("yt.date_col")}</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.map((v) => (
                    <tr key={v.id} className="border-b border-border last:border-0 hover:bg-secondary/50 transition-colors">
                      <td className="p-3 text-sm max-w-[300px] truncate" title={v.title}>{v.title}</td>
                      <td className="p-3 text-right font-mono text-sm">{formatYTDuration(v.duration)}</td>
                      <td className="p-3 text-right font-mono text-sm">{fmtInt(v.viewCount)}</td>
                      <td className="p-3 text-right font-mono text-xs text-muted-foreground">
                        {new Date(v.publishedAt).toLocaleDateString(language === "pt" ? "pt-BR" : "en-US")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="border-t border-border pt-6 mt-6">
          <PlatformCampaignSection platformReach={platformReach} platformLabel="YouTube" />
        </div>

        {!loading && videos.length === 0 && !channel && (
          <div className="card-surface p-8 text-center text-muted-foreground text-sm">
            {t("yt.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
