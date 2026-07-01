import { useState, useMemo } from "react";
import { MetricCard } from "@/components/MetricCard";
import { NumberField, FieldSection } from "@/components/FieldGroup";
import { fmtInt } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { PlatformCampaignSection } from "@/components/platform/PlatformCampaignSection";
import * as XLSX from "xlsx";
import {
  getKickChannel, getKickVideos, analyzeThumbnails,
  type KickChannel, type KickVideo, type GameDetection,
} from "@/lib/youtube-kick-api";

export function KickTab() {
  const { t, language } = useLanguage();
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [channel, setChannel] = useState<KickChannel | null>(null);
  const [videos, setVideos] = useState<KickVideo[]>([]);
  const [avgViewers, setAvgViewers] = useState(0);
  const [plannedHours, setPlannedHours] = useState(0);
  const [aiGames, setAiGames] = useState<GameDetection[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  const fetchChannel = async () => {
    if (!username.trim()) return;
    setLoading(true);
    try {
      const ch = await getKickChannel(username.trim());
      setChannel(ch);
      toast.success(`${ch.displayName} — ${t("kick.channel_loaded")}`, {
        description: `${fmtInt(ch.followers)} ${t("kick.followers")}${ch.isLive ? ' · LIVE' : ''}`,
      });
      try {
        const vids = await getKickVideos(username.trim());
        setVideos(vids);
      } catch { setVideos([]); }
    } catch (err: any) {
      toast.error(t("kick.error_channel"), { description: err.message });
    }
    setLoading(false);
  };

  const analyzeWithAI = async () => {
    const thumbs = videos.map(v => v.thumbnailUrl).filter(Boolean) as string[];
    if (thumbs.length === 0) { toast.error(t("kick.no_thumbs")); return; }
    setAiLoading(true);
    try {
      const games = await analyzeThumbnails(thumbs.slice(0, 15), channel?.displayName || '', 'Kick');
      setAiGames(games);
      toast.success(`${games.filter(g => g.category !== 'not_casino').length} jogos detectados`);
    } catch (err: any) {
      toast.error(t("yt.error_ai"), { description: err.message });
    }
    setAiLoading(false);
  };

  const viewerHours = useMemo(() => avgViewers * plannedHours, [avgViewers, plannedHours]);
  const platformReach = viewerHours;

  const downloadExcel = () => {
    const data: any[][] = [
      ["Kick - Relatório"],
      [""],
      ["Canal", channel?.displayName || username],
      ["Seguidores", channel?.followers || 0],
      ["Status", channel?.isLive ? "LIVE" : "OFFLINE"],
      [""],
      ["Avg viewers", avgViewers],
      ["Horas contratadas", plannedHours],
      ["Viewer-hours (live)", viewerHours],
    ];
    if (aiGames.length > 0) {
      data.push([""], ["--- Jogos detectados (IA) ---"], ["Jogo", "Provedora", "Categoria"]);
      for (const g of aiGames) data.push([g.game, g.provider || "-", g.category]);
    }
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 30 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Kick");
    XLSX.writeFile(wb, `analise-kick-${username || 'canal'}.xlsx`);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <FieldSection title={t("kick.search_channel")}>
          <div className="flex gap-2">
            <Input
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchChannel()}
              className="font-mono"
            />
            <Button onClick={fetchChannel} disabled={loading} size="sm" className="shrink-0">
              {loading ? t("app.searching") : t("app.search")}
            </Button>
          </div>
          {channel && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50 border border-border mt-2">
              {channel.avatarUrl && (
                <img src={channel.avatarUrl} alt={channel.displayName} className="w-10 h-10 rounded-full" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-sm truncate">{channel.displayName}</span>
                  {channel.verified && <span className="text-primary text-xs">✓</span>}
                  {channel.isLive && <span className="text-xs text-accent animate-pulse-slow">● LIVE</span>}
                </div>
                <span className="text-xs text-muted-foreground">{fmtInt(channel.followers)} {t("kick.followers")}</span>
              </div>
            </div>
          )}
        </FieldSection>

        <FieldSection title="Base de audiência">
          <NumberField label={t("kick.avg_viewers")} value={avgViewers} onChange={setAvgViewers} step={100} />
          <NumberField label={t("kick.contracted_hours")} value={plannedHours} onChange={setPlannedHours} />
        </FieldSection>
      </div>

      <div className="lg:col-span-3 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{t("app.results")}</h2>
          <Button variant="outline" size="sm" onClick={downloadExcel}>{t("app.export_excel")}</Button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <MetricCard label={t("kick.viewer_hours")} value={fmtInt(viewerHours)} />
          <MetricCard label={t("kick.avg_viewers")} value={fmtInt(avgViewers)} />
          <MetricCard label={t("kick.contracted_hours")} value={fmtInt(plannedHours)} />
        </div>

        {videos.length > 0 && (
          <div className="flex items-center gap-3 pt-2">
            <Button variant="outline" size="sm" onClick={analyzeWithAI} disabled={aiLoading}>
              {aiLoading ? t("yt.ai_analyzing") : t("yt.ai_detect")}
            </Button>
            <span className="text-xs text-muted-foreground">{t("kick.ai_analyzes_vods")}</span>
          </div>
        )}

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

        {videos.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs text-muted-foreground uppercase tracking-wider">VODs ({videos.length})</h3>
            <div className="card-surface overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                     <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-3">{t("yt.title_col")}</th>
                     <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">{t("yt.views_col")}</th>
                     <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">{t("yt.date_col")}</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.map((v) => (
                    <tr key={v.id} className="border-b border-border last:border-0 hover:bg-secondary/50 transition-colors">
                      <td className="p-3 text-sm max-w-[300px] truncate" title={v.title}>{v.title}</td>
                      <td className="p-3 text-right font-mono text-sm">{fmtInt(v.viewCount)}</td>
                      <td className="p-3 text-right font-mono text-xs text-muted-foreground">
                        {v.createdAt ? new Date(v.createdAt).toLocaleDateString(language === "pt" ? "pt-BR" : "en-US") : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="border-t border-border pt-6 mt-6">
          <PlatformCampaignSection platformReach={platformReach} platformLabel="Kick" />
        </div>

        {!loading && !channel && (
          <div className="card-surface p-8 text-center text-muted-foreground text-sm">
            {t("kick.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
