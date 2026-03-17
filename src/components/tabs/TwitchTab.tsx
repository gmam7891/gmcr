import { useState, useMemo } from "react";
import { MetricCard } from "@/components/MetricCard";
import { NumberField, FieldSection } from "@/components/FieldGroup";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtMoney, fmtInt, fmtPercent } from "@/lib/formatters";

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

  const results = useMemo(() => {
    const liveViews = avgViewers * plannedHours;
    const churnedViews = churnFactor > 0 ? liveViews * churnFactor : liveViews;
    const vodViews = vodViewsPerHour * plannedHours;
    const uniqueViews = churnedViews + vodViews;
    const clicks = uniqueViews * (ctrTw / 100);
    const ftd = clicks * (cvrTw / 100);
    const revenue = ftd * valueFtdTw;
    const roi = fee > 0 ? ((revenue - fee) / fee) * 100 : 0;
    const cpa = ftd > 0 ? fee / ftd : null;
    const roas = fee > 0 ? revenue / fee : 0;
    const profit = revenue - fee;
    const targetRoi = roiAlvo / 100;
    const feeMaxRoi = targetRoi > 0 ? revenue / (1 + targetRoi) : null;

    return { uniqueViews, clicks, ftd, revenue, roi, cpa, roas, profit, feeMaxRoi };
  }, [avgViewers, plannedHours, churnFactor, vodViewsPerHour, ctrTw, cvrTw, valueFtdTw, fee, roiAlvo]);

  const getStatus = () => {
    if (fee <= 0) return undefined;
    const targetRoi = roiAlvo / 100;
    if (results.roi / 100 >= targetRoi && (results.cpa == null || results.cpa <= cpaAlvo)) return "go" as const;
    if (results.roi >= 0) return "warning" as const;
    return "nogo" as const;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <FieldSection title="Canal">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground uppercase tracking-wider">Login do canal</label>
            <input
              type="text"
              value={channel}
              onChange={(e) => setChannel(e.target.value.toLowerCase().trim())}
              placeholder="streamer_login"
              className="flex h-10 w-full rounded-md border border-input bg-secondary px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <NumberField label="Fee / investimento" value={fee} onChange={setFee} step={1000} suffix="R$" />
          <NumberField label="Horas contratadas (mês)" value={plannedHours} onChange={setPlannedHours} />
          <NumberField label="Fator de churn" value={churnFactor} onChange={setChurnFactor} />
        </FieldSection>

        <FieldSection title="Dados do canal (manual)">
          <NumberField label="Avg viewers (30d)" value={avgViewers} onChange={setAvgViewers} step={100} />
          <NumberField label="Peak viewers (30d)" value={peakViewers} onChange={setPeakViewers} step={100} />
          <NumberField label="VOD views/hora" value={vodViewsPerHour} onChange={setVodViewsPerHour} step={10} />
        </FieldSection>

        <FieldSection title="Valuation financeiro">
          <NumberField label="ROI alvo" value={roiAlvo} onChange={setRoiAlvo} step={5} suffix="%" />
          <NumberField label="CPA alvo" value={cpaAlvo} onChange={setCpaAlvo} step={25} suffix="R$" />
          <NumberField label="CTR Twitch" value={ctrTw} onChange={setCtrTw} step={0.1} suffix="%" />
          <NumberField label="CVR para FTD" value={cvrTw} onChange={setCvrTw} step={0.1} suffix="%" />
          <NumberField label="Valor por FTD" value={valueFtdTw} onChange={setValueFtdTw} step={50} suffix="R$" />
        </FieldSection>
      </div>

      <div className="lg:col-span-3 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <MetricCard label="Avg viewers (30d)" value={fmtInt(avgViewers)} />
          <MetricCard label="Peak (30d)" value={fmtInt(peakViewers)} />
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
