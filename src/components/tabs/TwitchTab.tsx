import { useState, useMemo } from "react";
import { MetricCard } from "@/components/MetricCard";
import { NumberField, FieldSection } from "@/components/FieldGroup";
import { fmtInt } from "@/lib/formatters";
import { getUser, getStream, getVods, parseDuration, type TwitchUser, type TwitchStream, type TwitchVod } from "@/lib/twitch-api";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { PlatformCampaignSection } from "@/components/platform/PlatformCampaignSection";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export function TwitchTab() {
  const { t, language } = useLanguage();
  const [channel, setChannel] = useState("");
  const [plannedHours, setPlannedHours] = useState(0);
  const [churnFactor, setChurnFactor] = useState(0);
  const [avgViewers, setAvgViewers] = useState(0);
  const [peakViewers, setPeakViewers] = useState(0);
  const [vodViewsPerHour, setVodViewsPerHour] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sullyLoading, setSullyLoading] = useState(false);
  const [userData, setUserData] = useState<TwitchUser | null>(null);
  const [streamData, setStreamData] = useState<TwitchStream | null>(null);
  const [vodStats, setVodStats] = useState<{ count: number; avgViews: number; medianViews: number; vph: number } | null>(null);
  const [gameViewership, setGameViewership] = useState<Array<{ category: string; avgViewers: number; hoursWatched: number }>>([]);

  const fetchChannel = async () => {
    if (!channel.trim()) return;
    setLoading(true);
    try {
      const user = await getUser(channel);
      setUserData(user);
      if (!user) { setLoading(false); return; }
      const [stream, allVods] = await Promise.all([getStream(channel), getVods(user.id, 50)]);
      setStreamData(stream);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const vods = allVods.filter((v: TwitchVod) => new Date(v.created_at) >= thirtyDaysAgo);
      if (vods.length > 0) {
        const views = vods.map((v: TwitchVod) => v.view_count);
        const hours = vods.map((v: TwitchVod) => parseDuration(v.duration) / 60);
        const totalViews = views.reduce((a: number, b: number) => a + b, 0);
        const totalHours = hours.reduce((a: number, b: number) => a + b, 0);
        const sorted = [...views].sort((a, b) => a - b);
        const median = sorted.length % 2 === 0 ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : sorted[Math.floor(sorted.length / 2)];
        const vph = totalHours > 0 ? totalViews / totalHours : 0;
        setVodStats({ count: vods.length, avgViews: totalViews / vods.length, medianViews: median, vph });
        setVodViewsPerHour(Math.round(vph));
      }
    } catch (err) { console.error('Twitch fetch error:', err); }
    setLoading(false);

    setSullyLoading(true);
    try {
      const { data: sully } = await supabase.functions.invoke("sullygnome-scraper", {
        body: { action: "scrape", streamer_login: channel.trim().toLowerCase(), period: 30 },
      });
      if (sully?.summary?.overallAvgViewers > 0) setAvgViewers(sully.summary.overallAvgViewers);
      if (sully?.summary?.overallPeakViewers > 0) setPeakViewers(sully.summary.overallPeakViewers);
      const stats = Array.isArray(sully?.gameStats) ? sully.gameStats : [];
      setGameViewership(
        stats
          .filter((g: any) => g?.category && g.avgViewers > 0)
          .sort((a: any, b: any) => b.avgViewers - a.avgViewers)
          .slice(0, 10)
          .map((g: any) => ({ category: g.category, avgViewers: g.avgViewers, hoursWatched: g.hoursWatched })),
      );
    } catch (err) { console.warn("SullyGnome auto-fetch failed:", err); }
    setSullyLoading(false);
  };

  const reachStats = useMemo(() => {
    const avgViewerHours = avgViewers * plannedHours;
    const peakViewerHours = peakViewers * plannedHours;
    const churnMultiplier = churnFactor > 0 && churnFactor <= 1 ? churnFactor : 1;
    const uniqueLiveViewers = avgViewers * churnMultiplier;
    const vodViews = vodViewsPerHour * plannedHours;
    const totalReach = (uniqueLiveViewers * plannedHours) + vodViews;
    return { avgViewerHours, peakViewerHours, uniqueLiveViewers, vodViews, totalReach };
  }, [avgViewers, peakViewers, plannedHours, churnFactor, vodViewsPerHour]);

  const isLive = !!streamData;
  const isCasino = streamData?.game_id === "29452";
  const platformReach = reachStats.totalReach;

  const downloadExcel = () => {
    const data = [
      ["Metric", "Value"],
      [t("tw.channel"), channel],
      ["Status", isLive ? "LIVE" : "OFFLINE"],
      [t("tw.avg_viewers_30d"), avgViewers],
      [t("tw.peak_viewers_30d"), peakViewers],
      [t("tw.contracted_hours"), plannedHours],
      [t("tw.uniqueness_factor"), churnFactor],
      [t("tw.vod_views_hour"), vodViewsPerHour],
      ["", ""],
      [t("tw.viewer_hours_avg"), reachStats.avgViewerHours],
      [t("tw.viewer_hours_peak"), reachStats.peakViewerHours],
      [t("tw.unique_viewers"), reachStats.uniqueLiveViewers],
      [t("tw.vod_views"), reachStats.vodViews],
      [t("tw.total_reach"), reachStats.totalReach],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 30 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Twitch");
    XLSX.writeFile(wb, `analise-twitch-${channel || 'channel'}.xlsx`);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <FieldSection title={t("tw.channel")}>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground uppercase tracking-wider">{t("tw.channel_login")}</label>
            <div className="flex gap-2">
              <input type="text" value={channel} onChange={(e) => setChannel(e.target.value.toLowerCase().trim())} placeholder="streamer_login" className="flex h-10 w-full rounded-md border border-input bg-secondary px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onKeyDown={(e) => e.key === 'Enter' && fetchChannel()} />
              <Button onClick={fetchChannel} disabled={loading || !channel.trim()}>
                {loading ? "..." : t("app.search")}
              </Button>
            </div>
          </div>
          <NumberField label={t("tw.contracted_hours")} value={plannedHours} onChange={setPlannedHours} />
          <NumberField label={t("tw.uniqueness_factor")} value={churnFactor} onChange={setChurnFactor} step={0.1} />
        </FieldSection>

        <FieldSection title={t("tw.manual_data")}>
          {sullyLoading && (
            <p className="text-xs text-muted-foreground">⏳ Buscando CCV histórico no SullyGnome...</p>
          )}
          <NumberField label={`${t("tw.avg_viewers_30d")}${avgViewers > 0 && !sullyLoading ? " ✓ SullyGnome" : ""}`} value={avgViewers} onChange={setAvgViewers} step={100} />
          <NumberField label={`${t("tw.peak_viewers_30d")}${peakViewers > 0 && !sullyLoading ? " ✓ SullyGnome" : ""}`} value={peakViewers} onChange={setPeakViewers} step={100} />
          <NumberField label={t("tw.vod_views_hour")} value={vodViewsPerHour} onChange={setVodViewsPerHour} step={10} />
        </FieldSection>
      </div>

      <div className="lg:col-span-3 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{t("app.results")}</h2>
          <Button variant="outline" size="sm" onClick={downloadExcel}>{t("app.export_excel")}</Button>
        </div>
        {userData && (
          <div className="flex items-center gap-4 card-surface p-4">
            <img src={userData.profile_image_url} alt={userData.display_name} className="w-12 h-12 rounded-full" />
            <div className="flex-1">
              <p className="font-medium text-foreground">{userData.display_name}</p>
              <p className="text-xs text-muted-foreground">{userData.broadcaster_type}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-accent animate-pulse-slow' : 'bg-muted-foreground'}`} />
              <span className="text-xs font-mono">{isLive ? 'LIVE' : 'OFFLINE'}</span>
            </div>
          </div>
        )}

        {isLive && !isCasino && (
          <div className="card-surface border-destructive/30 p-3 text-sm text-destructive">
            ❌ {t("tw.not_casino")} {streamData?.game_name}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Status" value={isLive ? "✅ LIVE" : "⭕ OFF"} />
          <MetricCard label={t("tw.viewers_now")} value={isLive ? fmtInt(streamData?.viewer_count) : "-"} />
          <MetricCard label={isLive ? t("tw.category") : t("tw.avg_viewers_30d")} value={isLive ? (streamData?.game_name ?? "-") : fmtInt(avgViewers)} />
        </div>

        {vodStats && (
          <div className="grid grid-cols-4 gap-3">
            <MetricCard label={t("tw.vods_last_30d")} value={fmtInt(vodStats.count)} />
            <MetricCard label={t("tw.avg_vod_views")} value={fmtInt(vodStats.avgViews)} />
            <MetricCard label={t("tw.median_views")} value={fmtInt(vodStats.medianViews)} />
            <MetricCard label={t("tw.views_hour_vod")} value={fmtInt(vodStats.vph)} />
          </div>
        )}

        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider pt-2">{t("tw.reach_projection")} ({fmtInt(plannedHours)}{t("tw.contracted_hours_label")})</h2>
        <div className="grid grid-cols-5 gap-3">
          <MetricCard label={t("tw.viewer_hours_avg")} value={fmtInt(reachStats.avgViewerHours)} />
          <MetricCard label={t("tw.viewer_hours_peak")} value={fmtInt(reachStats.peakViewerHours)} />
          <MetricCard label={t("tw.unique_viewers")} value={fmtInt(reachStats.uniqueLiveViewers)} />
          <MetricCard label={t("tw.vod_views")} value={fmtInt(reachStats.vodViews)} />
          <MetricCard label={t("tw.total_reach")} value={fmtInt(reachStats.totalReach)} />
        </div>

        {gameViewership.length > 0 && (
          <div className="card-surface p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{language === "pt" ? "Viewership por Jogo (30d)" : "Viewership by Game (30d)"}</h2>
              <span className="text-[10px] text-muted-foreground font-mono">SullyGnome · panelviews</span>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={gameViewership} margin={{ top: 8, right: 8, left: 0, bottom: 56 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="category" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} angle={-30} textAnchor="end" interval={0} height={60} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }} formatter={(v: any, name: string) => [fmtInt(v), name === "avgViewers" ? "Avg Viewers" : "Hours Watched"]} />
                  <Bar dataKey="avgViewers" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="border-t border-border pt-6 mt-6">
          <PlatformCampaignSection platformReach={platformReach} platformLabel="Twitch" />
        </div>
      </div>
    </div>
  );
}
