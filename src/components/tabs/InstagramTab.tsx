import { useState, useMemo } from "react";
import { MetricCard } from "@/components/MetricCard";
import { NumberField, FieldSection } from "@/components/FieldGroup";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtMoney, fmtInt, fmtPercent } from "@/lib/formatters";

export function InstagramTab() {
  const [seguidores, setSeguidores] = useState(0);
  const [percIcp, setPercIcp] = useState(0);
  const [reelsQty, setReelsQty] = useState(0);
  const [reelsViews, setReelsViews] = useState(0);
  const [reelsCtr, setReelsCtr] = useState(0);
  const [storiesQty, setStoriesQty] = useState(0);
  const [storiesViews, setStoriesViews] = useState(0);
  const [storiesCtr, setStoriesCtr] = useState(0);
  const [tiktokQty, setTiktokQty] = useState(0);
  const [tiktokViews, setTiktokViews] = useState(0);
  const [tiktokCtr, setTiktokCtr] = useState(0);
  const [manualClicks, setManualClicks] = useState(0);
  const [manualFtd, setManualFtd] = useState(0);
  const [cvrPercent, setCvrPercent] = useState(0);
  const [valueFtd, setValueFtd] = useState(0);
  const [fee, setFee] = useState(0);

  const results = useMemo(() => {
    const compradores = Math.round(seguidores * (percIcp / 100));
    const reelsTotal = reelsQty * reelsViews;
    const storiesTotal = storiesQty * storiesViews;
    const tiktokTotal = tiktokQty * tiktokViews;
    const totalViews = reelsTotal + storiesTotal + tiktokTotal;

    const clicks = manualClicks > 0
      ? manualClicks
      : (reelsTotal * reelsCtr / 100) + (storiesTotal * storiesCtr / 100) + (tiktokTotal * tiktokCtr / 100);

    const ftd = manualFtd > 0 ? manualFtd : clicks * (cvrPercent / 100);
    const revenue = ftd * valueFtd;
    const roi = fee > 0 ? ((revenue - fee) / fee) * 100 : 0;
    const cpa = ftd > 0 ? fee / ftd : null;

    return { compradores, totalViews, clicks, ftd, revenue, roi, cpa };
  }, [seguidores, percIcp, reelsQty, reelsViews, reelsCtr, storiesQty, storiesViews, storiesCtr, tiktokQty, tiktokViews, tiktokCtr, manualClicks, manualFtd, cvrPercent, valueFtd, fee]);

  const roiStatus = results.roi >= 200 ? "go" : results.roi >= 0 ? "warning" : "nogo";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Inputs */}
      <div className="lg:col-span-2 space-y-6">
        <FieldSection title="Audiência ICP">
          <NumberField label="Total de seguidores" value={seguidores} onChange={setSeguidores} step={1000} />
          <NumberField label="% ICP" value={percIcp} onChange={setPercIcp} step={0.1} max={100} suffix="%" />
          <MetricCard label="Compradores potenciais (ICP)" value={fmtInt(results.compradores)} className="mt-2" />
        </FieldSection>

        <FieldSection title="Reels">
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Qtd" value={reelsQty} onChange={setReelsQty} />
            <NumberField label="Views médias" value={reelsViews} onChange={setReelsViews} step={1000} />
            <NumberField label="CTR" value={reelsCtr} onChange={setReelsCtr} step={0.1} suffix="%" />
          </div>
        </FieldSection>

        <FieldSection title="Stories">
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Qtd" value={storiesQty} onChange={setStoriesQty} />
            <NumberField label="Views médias" value={storiesViews} onChange={setStoriesViews} step={500} />
            <NumberField label="CTR" value={storiesCtr} onChange={setStoriesCtr} step={0.1} suffix="%" />
          </div>
        </FieldSection>

        <FieldSection title="TikTok (opcional)">
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Qtd" value={tiktokQty} onChange={setTiktokQty} />
            <NumberField label="Views médias" value={tiktokViews} onChange={setTiktokViews} step={1000} />
            <NumberField label="CTR" value={tiktokCtr} onChange={setTiktokCtr} step={0.1} suffix="%" />
          </div>
        </FieldSection>

        <FieldSection title="Funil de conversão">
          <NumberField label="Cliques reais (0 = calcular)" value={manualClicks} onChange={setManualClicks} step={50} />
          <NumberField label="FTD real (0 = calcular)" value={manualFtd} onChange={setManualFtd} />
          <NumberField label="CVR para FTD" value={cvrPercent} onChange={setCvrPercent} step={0.1} suffix="%" />
          <NumberField label="Valor por FTD" value={valueFtd} onChange={setValueFtd} step={50} suffix="R$" />
          <NumberField label="Fee / investimento" value={fee} onChange={setFee} step={1000} suffix="R$" />
        </FieldSection>
      </div>

      {/* Results */}
      <div className="lg:col-span-3 space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Resultados</h2>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Views totais" value={fmtInt(results.totalViews)} />
          <MetricCard label="Cliques estimados" value={fmtInt(results.clicks)} />
          <MetricCard label="FTD projetado" value={fmtInt(results.ftd)} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Receita projetada" value={fmtMoney(results.revenue)} status={results.revenue > 0 ? "go" : undefined} />
          <MetricCard label="ROI" value={fee > 0 ? fmtPercent(results.roi, 0) : "-"} status={fee > 0 ? roiStatus : undefined} />
          <MetricCard label="CPA" value={fee > 0 ? fmtMoney(results.cpa) : "-"} />
        </div>
        {fee > 0 && (
          <StatusBadge status={results.roi >= 200 ? "go" : results.roi >= 0 ? "warning" : "nogo"} />
        )}
        <p className="text-xs text-muted-foreground mt-4">
          O filtro ICP serve para avaliar a qualidade esperada dos cliques/FTD. Views são totais.
        </p>
      </div>
    </div>
  );
}
