import { useState, useMemo } from "react";
import { MetricCard } from "@/components/MetricCard";
import { NumberField, FieldSection } from "@/components/FieldGroup";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtMoney, fmtInt, fmtPercent } from "@/lib/formatters";
import { getUser, getStream, getVods, parseDuration, type TwitchUser, type TwitchStream, type TwitchVod } from "@/lib/twitch-api";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import * as XLSX from "xlsx";

export function TwitchTab() {
  const { t, language } = useLanguage();
  const [channel, setChannel] = useState("");
  const [fee, setFee] = useState(0);
  const [plannedHours, setPlannedHours] = useState(0);
  const [churnFactor, setChurnFactor] = useState(0);
  const [avgViewers, setAvgViewers] = useState(0);
  const [peakViewers, setPeakViewers] = useState(0);
  const [roiAlvo, setRoiAlvo] = useState(0);
  const [cpaAlvo, setCpaAlvo] = useState(0);
  const [ctrTw, setCtrTw] = useState(0);
  const [cvrTw, setCvrTw] = useState(0);
  const [valueFtdTw, setValueFtdTw] = useState(0);
  const [vodViewsPerHour, setVodViewsPerHour] = useState(0);
  const [loading, setLoading] = useState(false);
  const [userData, setUserData] = useState<TwitchUser | null>(null);
  const [streamData, setStreamData] = useState<TwitchStream | null>(null);
  const [vodStats, setVodStats] = useState<{ count: number; avgViews: number; medianViews: number; vph: number } | null>(null);

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
  };

  const results = useMemo(() => {
    const avgViewerHours = avgViewers * plannedHours;
    const peakViewerHours = peakViewers * plannedHours;
    const churnMultiplier = churnFactor > 0 && churnFactor <= 1 ? churnFactor : 1;
    const uniqueLiveViewers = avgViewers * churnMultiplier;
    const vodViews = vodViewsPerHour * plannedHours;
    const totalReach = (uniqueLiveViewers * plannedHours) + vodViews;
    const clicks = totalReach * (ctrTw / 100);
    const ftd = clicks * (cvrTw / 100);
    const revenue = ftd * valueFtdTw;
    const roi = fee > 0 ? ((revenue - fee) / fee) * 100 : 0;
    const cpa = ftd > 0 ? fee / ftd : null;
    const roas = fee > 0 ? revenue / fee : 0;
    const profit = revenue - fee;
    const targetRoi = roiAlvo / 100;
    const feeMaxRoi = targetRoi > 0 ? revenue / (1 + targetRoi) : null;
    return { avgViewerHours, peakViewerHours, uniqueLiveViewers, vodViews, totalReach, clicks, ftd, revenue, roi, cpa, roas, profit, feeMaxRoi };
  }, [avgViewers, peakViewers, plannedHours, churnFactor, vodViewsPerHour, ctrTw, cvrTw, valueFtdTw, fee, roiAlvo]);

  const getStatus = () => {
    if (fee <= 0) return undefined;
    const targetRoi = roiAlvo / 100;
    if (results.roi / 100 >= targetRoi && (results.cpa == null || results.cpa <= cpaAlvo)) return "go" as const;
    if (results.roi >= 0) return "warning" as const;
    return "nogo" as const;
  };

  const isLive = !!streamData;
  const isCasino = streamData?.game_id === "29452";
  const locale = language === "pt" ? "pt-BR" : "en-US";

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
      [t("tw.ctr_twitch"), `${ctrTw}%`],
      [t("tw.cvr_ftd"), `${cvrTw}%`],
      [t("tw.value_per_ftd"), valueFtdTw],
      [t("tw.fee"), fee],
      [t("tw.target_roi"), `${roiAlvo}%`],
      [t("tw.target_cpa"), cpaAlvo],
      ["", ""],
      [t("tw.viewer_hours_avg"), results.avgViewerHours],
      [t("tw.viewer_hours_peak"), results.peakViewerHours],
      [t("tw.unique_viewers"), results.uniqueLiveViewers],
      [t("tw.vod_views"), results.vodViews],
      [t("tw.total_reach"), results.totalReach],
      [t("tw.estimated_clicks"), Math.round(results.clicks)],
      [t("tw.projected_ftd"), Math.round(results.ftd)],
      [t("tw.projected_revenue"), results.revenue],
      ["ROAS", results.roas],
      ["CPA (FTD)", results.cpa],
      ["ROI", `${results.roi.toFixed(1)}%`],
      [t("tw.profit_loss"), results.profit],
      [t("tw.max_fee"), results.feeMaxRoi],
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
          <NumberField label={t("tw.fee")} value={fee} onChange={setFee} step={1000} suffix="R$" />
          <NumberField label={t("tw.contracted_hours")} value={plannedHours} onChange={setPlannedHours} />
          <NumberField label={t("tw.uniqueness_factor")} value={churnFactor} onChange={setChurnFactor} step={0.1} />
        </FieldSection>

        <FieldSection title={t("tw.financial_valuation")}>
          <NumberField label={t("tw.target_roi")} value={roiAlvo} onChange={setRoiAlvo} step={5} suffix="%" />
          <NumberField label={t("tw.target_cpa")} value={cpaAlvo} onChange={setCpaAlvo} step={25} suffix="R$" />
          <NumberField label={t("tw.ctr_twitch")} value={ctrTw} onChange={setCtrTw} step={0.1} suffix="%" />
          <NumberField label={t("tw.cvr_ftd")} value={cvrTw} onChange={setCvrTw} step={0.1} suffix="%" />
          <NumberField label={t("tw.value_per_ftd")} value={valueFtdTw} onChange={setValueFtdTw} step={50} suffix="R$" />
        </FieldSection>

        <FieldSection title={t("tw.manual_data")}>
          <NumberField label={t("tw.avg_viewers_30d")} value={avgViewers} onChange={setAvgViewers} step={100} />
          <NumberField label={t("tw.peak_viewers_30d")} value={peakViewers} onChange={setPeakViewers} step={100} />
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
          <MetricCard label={t("tw.viewer_hours_avg")} value={fmtInt(results.avgViewerHours)} />
          <MetricCard label={t("tw.viewer_hours_peak")} value={fmtInt(results.peakViewerHours)} />
          <MetricCard label={t("tw.unique_viewers")} value={fmtInt(results.uniqueLiveViewers)} />
          <MetricCard label={t("tw.vod_views")} value={fmtInt(results.vodViews)} />
          <MetricCard label={t("tw.total_reach")} value={fmtInt(results.totalReach)} />
        </div>

        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider pt-2">{t("tw.financial_projection")}</h2>
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label={t("tw.estimated_clicks")} value={fmtInt(results.clicks)} />
          <MetricCard label={t("tw.projected_ftd")} value={fmtInt(results.ftd)} />
          <MetricCard label={t("tw.projected_revenue")} value={fmtMoney(results.revenue)} />
          <MetricCard label="ROAS" value={fmtInt(results.roas)} />
        </div>
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="CPA (FTD)" value={fmtMoney(results.cpa)} />
          <MetricCard label="ROI" value={fee > 0 ? fmtPercent(results.roi, 0) : "-"} status={getStatus()} />
          <MetricCard label={t("tw.profit_loss")} value={fmtMoney(results.profit)} status={results.profit > 0 ? "go" : results.profit < 0 ? "nogo" : undefined} />
          <MetricCard label={t("tw.max_fee")} value={fmtMoney(results.feeMaxRoi)} />
        </div>
        {fee > 0 && getStatus() && <StatusBadge status={getStatus()!} />}
      </div>
    </div>
  );
}
