import { useState, useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { MetricCard } from "@/components/MetricCard";
import { NumberField, FieldSection } from "@/components/FieldGroup";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtMoney, fmtInt, fmtPercent } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  calculateIvs, calculateFairPrice, compareToBenchmark,
  MARKET_BENCHMARKS, type IvsResult, type BenchmarkResult,
} from "@/lib/ivs-engine";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function BenchmarkBar({ label, value, benchmark, unit, higherIsBetter = true }: {
  label: string; value: number; benchmark: number; unit: string; higherIsBetter?: boolean;
}) {
  const result = compareToBenchmark(value, benchmark, higherIsBetter);
  const pct = Math.min((value / (benchmark * 2)) * 100, 100);
  const benchmarkPct = 50;
  const labelMap: Record<BenchmarkResult, { text: string; className: string }> = {
    above: { text: "Acima do mercado", className: "text-accent" },
    average: { text: "Dentro da média", className: "text-warning" },
    below: { text: "Abaixo do mercado", className: "text-destructive" },
  };
  const info = labelMap[result];
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={info.className}>{info.text}</span>
      </div>
      <div className="relative h-2 bg-secondary rounded-full overflow-hidden">
        <div className="absolute h-full bg-primary/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
        <div className="absolute h-full w-px bg-muted-foreground/50" style={{ left: `${benchmarkPct}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
        <span>{value.toFixed(1)}{unit}</span>
        <span>Mercado: {benchmark}{unit}</span>
      </div>
    </div>
  );
}

function ScoreGauge({ ivs }: { ivs: IvsResult }) {
  const color = ivs.total >= 80 ? "text-accent" : ivs.total >= 60 ? "text-primary" : ivs.total >= 40 ? "text-warning" : "text-destructive";
  const bgColor = ivs.total >= 80 ? "bg-accent" : ivs.total >= 60 ? "bg-primary" : ivs.total >= 40 ? "bg-warning" : "bg-destructive";
  return (
    <div className="card-surface p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Influencer Value Score</p>
          <div className="flex items-baseline gap-2 mt-1">
            <span className={`text-4xl font-mono font-bold ${color}`}>{ivs.total}</span>
            <span className="text-sm text-muted-foreground">/100</span>
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant={ivs.total >= 60 ? "default" : "destructive"} className="text-xs cursor-help">
              {ivs.classification}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs space-y-1" side="left">
            <p className="font-semibold">Composição do Score:</p>
            <p>ROI: {ivs.pillars.roi}/25</p>
            <p>ICP Match: {ivs.pillars.icpMatch}/20</p>
            <p>Consistência: {ivs.pillars.consistency}/20</p>
            <p>Conversão: {ivs.pillars.conversionEfficiency}/20</p>
            <p>Risco: {ivs.pillars.riskLevel}/15</p>
          </TooltipContent>
        </Tooltip>
      </div>
      <Progress value={ivs.total} className={`h-2 [&>div]:${bgColor}`} />
      {/* Pillar breakdown */}
      <div className="grid grid-cols-5 gap-2 pt-1">
        {([
          ["ROI", ivs.pillars.roi, 25],
          ["ICP", ivs.pillars.icpMatch, 20],
          ["Consist.", ivs.pillars.consistency, 20],
          ["Conversão", ivs.pillars.conversionEfficiency, 20],
          ["Risco", ivs.pillars.riskLevel, 15],
        ] as [string, number, number][]).map(([label, val, max]) => (
          <div key={label} className="text-center space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
            <p className="text-xs font-mono font-semibold text-foreground">{val}/{max}</p>
            <div className="h-1 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${(val / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RiskSection({ ivs }: { ivs: IvsResult }) {
  const [open, setOpen] = useState(false);
  const riskColor = ivs.riskLabel === "Baixo" ? "bg-accent/10 text-accent border-accent/20"
    : ivs.riskLabel === "Médio" ? "bg-warning/10 text-warning border-warning/20"
    : "bg-destructive/10 text-destructive border-destructive/20";
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-3">
        <div className={`inline-flex items-center px-3 py-1.5 rounded-lg border text-xs font-medium ${riskColor}`}>
          {ivs.riskLabel === "Baixo" ? "🛡️" : ivs.riskLabel === "Médio" ? "⚠️" : "🔴"} Risco {ivs.riskLabel}
        </div>
        {ivs.riskFactors.length > 0 && (
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-7">
              {open ? "Ocultar detalhes" : "Por que esse risco?"}
            </Button>
          </CollapsibleTrigger>
        )}
      </div>
      <CollapsibleContent className="mt-2">
        <div className="card-surface p-3 space-y-1.5">
          {ivs.riskFactors.map((f, i) => (
            <p key={i} className="text-xs text-muted-foreground flex items-center gap-2">
              <span className="text-destructive">•</span> {f}
            </p>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function SimulatorTab() {
  // Base scenario
  const [baseFee, setBaseFee] = useState(10000);
  const [baseCtr, setBaseCtr] = useState(1.5);
  const [baseCvr, setBaseCvr] = useState(3);
  const [baseValueFtd, setBaseValueFtd] = useState(500);
  const [basePercIcp, setBasePercIcp] = useState(25);
  const [baseAvgViewers, setBaseAvgViewers] = useState(5000);
  const [basePeakViewers, setBasePeakViewers] = useState(15000);
  const [basePlannedHours, setBasePlannedHours] = useState(20);
  const [baseTargetRoi, setBaseTargetRoi] = useState(300);

  // Simulated scenario (sliders)
  const [simFee, setSimFee] = useState(10000);
  const [simCtr, setSimCtr] = useState(1.5);
  const [simCvr, setSimCvr] = useState(3);
  const [simValueFtd, setSimValueFtd] = useState(500);
  const [simPercIcp, setSimPercIcp] = useState(25);

  // Sync base → sim on base change
  const applyBaseToSim = () => {
    setSimFee(baseFee);
    setSimCtr(baseCtr);
    setSimCvr(baseCvr);
    setSimValueFtd(baseValueFtd);
    setSimPercIcp(basePercIcp);
  };

  const calcScenario = (fee: number, ctr: number, cvr: number, valueFtd: number, percIcp: number) => {
    const liveViews = baseAvgViewers * basePlannedHours;
    const icpFactor = percIcp / 100;
    const viewsIcp = liveViews * icpFactor;
    const clicks = viewsIcp * (ctr / 100);
    const ftd = clicks * (cvr / 100);
    const revenue = ftd * valueFtd;
    const roi = fee > 0 ? ((revenue - fee) / fee) * 100 : 0;
    const cpa = ftd > 0 ? fee / ftd : null;
    const profit = revenue - fee;
    return { liveViews, viewsIcp, clicks, ftd, revenue, roi, cpa, profit };
  };

  const baseResults = useMemo(() => calcScenario(baseFee, baseCtr, baseCvr, baseValueFtd, basePercIcp), [baseFee, baseCtr, baseCvr, baseValueFtd, basePercIcp, baseAvgViewers, basePlannedHours]);
  const simResults = useMemo(() => calcScenario(simFee, simCtr, simCvr, simValueFtd, simPercIcp), [simFee, simCtr, simCvr, simValueFtd, simPercIcp, baseAvgViewers, basePlannedHours]);

  const baseIvs = useMemo(() => calculateIvs({
    roi: baseResults.roi, percIcp: basePercIcp, avgViewers: baseAvgViewers,
    peakViewers: basePeakViewers, ctr: baseCtr, cvr: baseCvr,
  }), [baseResults.roi, basePercIcp, baseAvgViewers, basePeakViewers, baseCtr, baseCvr]);

  const simIvs = useMemo(() => calculateIvs({
    roi: simResults.roi, percIcp: simPercIcp, avgViewers: baseAvgViewers,
    peakViewers: basePeakViewers, ctr: simCtr, cvr: simCvr,
  }), [simResults.roi, simPercIcp, baseAvgViewers, basePeakViewers, simCtr, simCvr]);

  const fairPrice = useMemo(() => calculateFairPrice({
    estimatedRevenue: baseResults.revenue,
    targetRoi: baseTargetRoi,
  }), [baseResults.revenue, baseTargetRoi]);

  const feeStatus = baseFee <= fairPrice.max && baseFee >= fairPrice.min ? "go"
    : baseFee < fairPrice.min ? "warning" : "nogo";

  const [pdfLoading, setPdfLoading] = useState(false);

  const downloadPdf = async () => {
    setPdfLoading(true);
    try {
      const payload = {
        influencer: "Simulação",
        baseScenario: { fee: baseFee, ctr: baseCtr, cvr: baseCvr, valueFtd: baseValueFtd, percIcp: basePercIcp, avgViewers: baseAvgViewers, peakViewers: basePeakViewers, plannedHours: basePlannedHours },
        baseResults,
        simScenario: { fee: simFee, ctr: simCtr, cvr: simCvr, valueFtd: simValueFtd, percIcp: simPercIcp },
        simResults,
        baseIvs,
        simIvs,
        fairPrice,
        targetRoi: baseTargetRoi,
      };
      const { data, error } = await supabase.functions.invoke('generate-report', {
        body: payload,
      });
      if (error) throw error;

      // data is the PDF buffer
      const blob = new Blob([data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'relatorio-simulacao.pdf';
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Relatório PDF gerado!");
    } catch (err: any) {
      console.error('PDF error:', err);
      toast.error("Erro ao gerar PDF", { description: err.message });
    }
    setPdfLoading(false);
  };

  const delta = (base: number, sim: number) => {
    const diff = sim - base;
    if (diff === 0) return "";
    const sign = diff > 0 ? "+" : "";
    return `${sign}${diff.toFixed(1)}`;
  };

  return (
    <div className="space-y-6">
      {/* Top: IVS Score + Risk + Fair Price */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ScoreGauge ivs={baseIvs} />

        {/* Risk */}
        <div className="card-surface p-5 space-y-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Análise de Risco</p>
          <RiskSection ivs={baseIvs} />
          <div className="pt-2 space-y-2">
            <BenchmarkBar
              label="ROI" value={baseResults.roi}
              benchmark={MARKET_BENCHMARKS.roi.value}
              unit="%" higherIsBetter
            />
            <BenchmarkBar
              label="CPA" value={baseResults.cpa ?? 0}
              benchmark={MARKET_BENCHMARKS.cpa.value}
              unit="R$" higherIsBetter={false}
            />
          </div>
        </div>

        {/* Fair price */}
        <div className="card-surface p-5 space-y-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Preço Justo (Fee)</p>
          <NumberField label="ROI alvo" value={baseTargetRoi} onChange={setBaseTargetRoi} step={50} suffix="%" />
          <div className="space-y-1 pt-2">
            <p className="text-sm font-medium text-foreground">
              Faixa recomendada: <span className="text-accent font-mono">{fmtMoney(fairPrice.min)}</span> – <span className="text-accent font-mono">{fmtMoney(fairPrice.max)}</span>
            </p>
            <div className="relative h-3 bg-secondary rounded-full overflow-hidden mt-2">
              {/* Green zone */}
              <div
                className="absolute h-full bg-accent/30 rounded-full"
                style={{
                  left: `${Math.min((fairPrice.min / (fairPrice.max * 1.5)) * 100, 100)}%`,
                  width: `${Math.min(((fairPrice.max - fairPrice.min) / (fairPrice.max * 1.5)) * 100, 100)}%`,
                }}
              />
              {/* Current fee indicator */}
              <div
                className={`absolute h-full w-1 rounded-full ${feeStatus === "go" ? "bg-accent" : feeStatus === "warning" ? "bg-warning" : "bg-destructive"}`}
                style={{ left: `${Math.min((baseFee / (fairPrice.max * 1.5)) * 100, 98)}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
              <span>{fmtMoney(fairPrice.min)}</span>
              <span className={feeStatus === "go" ? "text-accent" : feeStatus === "nogo" ? "text-destructive" : "text-warning"}>
                Fee atual: {fmtMoney(baseFee)} ({feeStatus === "go" ? "Justo" : feeStatus === "warning" ? "Abaixo" : "Acima"})
              </span>
              <span>{fmtMoney(fairPrice.max)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Side-by-side comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Base scenario */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">📌 Cenário Base</h2>
            <Button variant="outline" size="sm" onClick={applyBaseToSim} className="text-xs">
              Copiar → Simulado
            </Button>
          </div>
          <div className="card-surface p-4 space-y-3">
            <NumberField label="Fee / investimento" value={baseFee} onChange={setBaseFee} step={1000} suffix="R$" />
            <NumberField label="Avg viewers" value={baseAvgViewers} onChange={setBaseAvgViewers} step={100} />
            <NumberField label="Peak viewers" value={basePeakViewers} onChange={setBasePeakViewers} step={100} />
            <NumberField label="Horas contratadas" value={basePlannedHours} onChange={setBasePlannedHours} />
            <NumberField label="% ICP" value={basePercIcp} onChange={setBasePercIcp} step={1} max={100} suffix="%" />
            <NumberField label="CTR" value={baseCtr} onChange={setBaseCtr} step={0.1} suffix="%" />
            <NumberField label="CVR" value={baseCvr} onChange={setBaseCvr} step={0.1} suffix="%" />
            <NumberField label="Valor por FTD" value={baseValueFtd} onChange={setBaseValueFtd} step={50} suffix="R$" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Receita" value={fmtMoney(baseResults.revenue)} status={baseResults.revenue > 0 ? "go" : undefined} />
            <MetricCard label="ROI" value={baseFee > 0 ? fmtPercent(baseResults.roi, 0) : "-"} status={baseFee > 0 ? (baseResults.roi >= 200 ? "go" : baseResults.roi >= 0 ? "warning" : "nogo") : undefined} />
            <MetricCard label="CPA" value={fmtMoney(baseResults.cpa)} />
            <MetricCard label="Lucro" value={fmtMoney(baseResults.profit)} status={baseResults.profit > 0 ? "go" : baseResults.profit < 0 ? "nogo" : undefined} />
          </div>
          <MetricCard label="IVS Score" value={`${baseIvs.total}/100 — ${baseIvs.classification}`} status={baseIvs.total >= 60 ? "go" : baseIvs.total >= 40 ? "warning" : "nogo"} />
        </div>

        {/* Simulated scenario */}
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">🔮 Cenário Simulado</h2>
          <div className="card-surface p-4 space-y-5">
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground uppercase tracking-wider">Fee</span>
                <span className="font-mono text-foreground">{fmtMoney(simFee)}</span>
              </div>
              <Slider value={[simFee]} onValueChange={([v]) => setSimFee(v)} min={0} max={Math.max(baseFee * 3, 50000)} step={500} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground uppercase tracking-wider">% ICP</span>
                <span className="font-mono text-foreground">{simPercIcp}%</span>
              </div>
              <Slider value={[simPercIcp]} onValueChange={([v]) => setSimPercIcp(v)} min={1} max={100} step={1} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground uppercase tracking-wider">CTR</span>
                <span className="font-mono text-foreground">{simCtr}%</span>
              </div>
              <Slider value={[simCtr * 10]} onValueChange={([v]) => setSimCtr(v / 10)} min={1} max={100} step={1} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground uppercase tracking-wider">CVR</span>
                <span className="font-mono text-foreground">{simCvr}%</span>
              </div>
              <Slider value={[simCvr * 10]} onValueChange={([v]) => setSimCvr(v / 10)} min={1} max={200} step={1} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground uppercase tracking-wider">Valor FTD</span>
                <span className="font-mono text-foreground">{fmtMoney(simValueFtd)}</span>
              </div>
              <Slider value={[simValueFtd]} onValueChange={([v]) => setSimValueFtd(v)} min={50} max={2000} step={50} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Receita" value={fmtMoney(simResults.revenue)} delta={delta(baseResults.revenue, simResults.revenue)} status={simResults.revenue > 0 ? "go" : undefined} />
            <MetricCard label="ROI" value={simFee > 0 ? fmtPercent(simResults.roi, 0) : "-"} delta={delta(baseResults.roi, simResults.roi)} status={simFee > 0 ? (simResults.roi >= 200 ? "go" : simResults.roi >= 0 ? "warning" : "nogo") : undefined} />
            <MetricCard label="CPA" value={fmtMoney(simResults.cpa)} delta={delta(baseResults.cpa ?? 0, simResults.cpa ?? 0)} />
            <MetricCard label="Lucro" value={fmtMoney(simResults.profit)} delta={delta(baseResults.profit, simResults.profit)} status={simResults.profit > 0 ? "go" : simResults.profit < 0 ? "nogo" : undefined} />
          </div>
          <MetricCard label="IVS Score" value={`${simIvs.total}/100 — ${simIvs.classification}`} delta={delta(baseIvs.total, simIvs.total)} status={simIvs.total >= 60 ? "go" : simIvs.total >= 40 ? "warning" : "nogo"} />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <Button onClick={downloadPdf} disabled={pdfLoading} className="gap-2">
          {pdfLoading ? "Gerando..." : "📄 Exportar Relatório PDF"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Inclui Score IVS, projeção financeira, risco e recomendação de fee.
        </p>
      </div>
    </div>
  );
}
