import { useState, useMemo } from "react";
import { MetricCard } from "@/components/MetricCard";
import { NumberField, FieldSection } from "@/components/FieldGroup";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtMoney, fmtInt, fmtPercent } from "@/lib/formatters";
import { getUser, getStream, getVods, parseDuration, type TwitchUser, type TwitchStream, type TwitchVod } from "@/lib/twitch-api";
import { Button } from "@/components/ui/button";
import * as XLSX from "xlsx";

export function TwitchTab() {
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

      const [stream, allVods] = await Promise.all([
        getStream(channel),
        getVods(user.id, 50),
      ]);
      setStreamData(stream);

      // Filter VODs to last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const vods = allVods.filter((v: TwitchVod) => new Date(v.created_at) >= thirtyDaysAgo);

      if (vods.length > 0) {
        const views = vods.map((v: TwitchVod) => v.view_count);
        const hours = vods.map((v: TwitchVod) => parseDuration(v.duration) / 60);
        const totalViews = views.reduce((a: number, b: number) => a + b, 0);
        const totalHours = hours.reduce((a: number, b: number) => a + b, 0);
        const sorted = [...views].sort((a, b) => a - b);
        const median = sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)];
        const vph = totalHours > 0 ? totalViews / totalHours : 0;
        setVodStats({ count: vods.length, avgViews: totalViews / vods.length, medianViews: median, vph });
        setVodViewsPerHour(Math.round(vph));
      }


    } catch (err) {
      console.error('Twitch fetch error:', err);
    }
    setLoading(false);
  };

  const results = useMemo(() => {
    // Viewer-hours = avg viewers × hours (total impressions over time)
    const avgViewerHours = avgViewers * plannedHours;
    const peakViewerHours = peakViewers * plannedHours;
    // Churn factor reduces unique reach (e.g. 0.7 = 70% são únicos, 30% são viewers repetidos)
    // If 0 or not set, assume no churn adjustment (100% unique)
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

  const downloadExcel = () => {
    const data = [
      ["Métrica", "Valor"],
      ["Canal", channel],
      ["Status", isLive ? "LIVE" : "OFFLINE"],
      ["Avg viewers (30d)", avgViewers],
      ["Peak viewers (30d)", peakViewers],
      ["Horas contratadas", plannedHours],
      ["Fator de churn", churnFactor],
      ["VOD views/hora", vodViewsPerHour],
      ["", ""],
      ["CTR Twitch", `${ctrTw}%`],
      ["CVR para FTD", `${cvrTw}%`],
      ["Valor por FTD", valueFtdTw],
      ["Fee / investimento", fee],
      ["ROI alvo", `${roiAlvo}%`],
      ["CPA alvo", cpaAlvo],
      ["", ""],
      ["Viewer-hours (avg)", results.avgViewerHours],
      ["Viewer-hours (peak)", results.peakViewerHours],
      ["Viewers únicos (live)", results.uniqueLiveViewers],
      ["Views VOD", results.vodViews],
      ["Reach total", results.totalReach],
      ["Cliques estimados", Math.round(results.clicks)],
      ["FTD projetado", Math.round(results.ftd)],
      ["Receita projetada", results.revenue],
      ["ROAS", results.roas],
      ["CPA (FTD)", results.cpa],
      ["ROI", `${results.roi.toFixed(1)}%`],
      ["Lucro / Prejuízo", results.profit],
      ["Fee máximo", results.feeMaxRoi],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 30 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Twitch");
    XLSX.writeFile(wb, `analise-twitch-${channel || 'canal'}.xlsx`);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <FieldSection title="Canal">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground uppercase tracking-wider">Login do canal</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={channel}
                onChange={(e) => setChannel(e.target.value.toLowerCase().trim())}
                placeholder="streamer_login"
                className="flex h-10 w-full rounded-md border border-input bg-secondary px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onKeyDown={(e) => e.key === 'Enter' && fetchChannel()}
              />
              <Button onClick={fetchChannel} disabled={loading || !channel.trim()}>
                {loading ? "..." : "Buscar"}
              </Button>
            </div>
          </div>
          <NumberField label="Fee / investimento" value={fee} onChange={setFee} step={1000} suffix="R$" />
          <NumberField label="Horas contratadas (mês)" value={plannedHours} onChange={setPlannedHours} />
          <NumberField label="Fator de churn" value={churnFactor} onChange={setChurnFactor} />
        </FieldSection>

        <FieldSection title="Valuation financeiro">
          <NumberField label="ROI alvo" value={roiAlvo} onChange={setRoiAlvo} step={5} suffix="%" />
          <NumberField label="CPA alvo" value={cpaAlvo} onChange={setCpaAlvo} step={25} suffix="R$" />
          <NumberField label="CTR Twitch" value={ctrTw} onChange={setCtrTw} step={0.1} suffix="%" />
          <NumberField label="CVR para FTD" value={cvrTw} onChange={setCvrTw} step={0.1} suffix="%" />
          <NumberField label="Valor por FTD" value={valueFtdTw} onChange={setValueFtdTw} step={50} suffix="R$" />
        </FieldSection>

        <FieldSection title="Dados manuais (override)">
          <NumberField label="Avg viewers (30d)" value={avgViewers} onChange={setAvgViewers} step={100} />
          <NumberField label="Peak viewers (30d)" value={peakViewers} onChange={setPeakViewers} step={100} />
          <NumberField label="VOD views/hora" value={vodViewsPerHour} onChange={setVodViewsPerHour} step={10} />
        </FieldSection>
      </div>

      <div className="lg:col-span-3 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Resultados</h2>
          <Button variant="outline" size="sm" onClick={downloadExcel}>
            📥 Exportar Excel
          </Button>
        </div>
        {/* Channel status */}
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
            ❌ Canal não está em Virtual Casino. Categoria atual: {streamData?.game_name}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Status" value={isLive ? "✅ LIVE" : "⭕ OFF"} />
          <MetricCard label="Viewers agora" value={isLive ? fmtInt(streamData?.viewer_count) : "-"} />
          <MetricCard label={isLive ? "Categoria" : "Avg viewers"} value={isLive ? (streamData?.game_name ?? "-") : fmtInt(avgViewers)} />
        </div>


        {vodStats && (
          <div className="grid grid-cols-4 gap-3">
            <MetricCard label="VODs (últimos 30d)" value={fmtInt(vodStats.count)} />
            <MetricCard label="Avg views VOD" value={fmtInt(vodStats.avgViews)} />
            <MetricCard label="Mediana views" value={fmtInt(vodStats.medianViews)} />
            <MetricCard label="Views/hora VOD" value={fmtInt(vodStats.vph)} />
          </div>
        )}

        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider pt-2">Projeção de views ({fmtInt(plannedHours)}h contratadas)</h2>
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="Views (avg viewers)" value={fmtInt(results.avgLiveViews)} />
          <MetricCard label="Views (peak viewers)" value={fmtInt(results.peakLiveViews)} />
          <MetricCard label="Views VOD" value={fmtInt(results.vodViews)} />
          <MetricCard label="Views únicas totais" value={fmtInt(results.uniqueViews)} />
        </div>

        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider pt-2">Projeção financeira</h2>
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="Cliques estimados" value={fmtInt(results.clicks)} />
          <MetricCard label="FTD projetado" value={fmtInt(results.ftd)} />
          <MetricCard label="Receita projetada" value={fmtMoney(results.revenue)} />
          <MetricCard label="ROAS" value={fmtInt(results.roas)} />
        </div>
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="CPA (FTD)" value={fmtMoney(results.cpa)} />
          <MetricCard label="ROI" value={fee > 0 ? fmtPercent(results.roi, 0) : "-"} status={getStatus()} />
          <MetricCard label="Lucro/Prejuízo" value={fmtMoney(results.profit)} status={results.profit > 0 ? "go" : results.profit < 0 ? "nogo" : undefined} />
          <MetricCard label="Fee máximo" value={fmtMoney(results.feeMaxRoi)} />
        </div>
        {fee > 0 && getStatus() && <StatusBadge status={getStatus()!} />}
      </div>
    </div>
  );
}
