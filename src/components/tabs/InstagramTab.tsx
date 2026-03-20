import { useState, useMemo } from "react";
import { MetricCard } from "@/components/MetricCard";
import { NumberField, FieldSection } from "@/components/FieldGroup";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtMoney, fmtInt, fmtPercent } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface ProfileData {
  username: string;
  fullName: string;
  profilePicUrl: string;
  followers: number;
  avgReelsViews: number;
  videoCount: number;
  estimatedCtr: number;
  storiesViewEstimate: number;
  engagementRate: number;
  isVerified: boolean;
}

export function InstagramTab() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);
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
    const icpFactor = percIcp / 100;
    const compradores = Math.round(seguidores * icpFactor);

    // Views totais (sem filtro ICP)
    const reelsTotal = reelsQty * reelsViews;
    const storiesTotal = storiesQty * storiesViews;
    const tiktokTotal = tiktokQty * tiktokViews;
    const totalViews = reelsTotal + storiesTotal + tiktokTotal;

    // Views ICP (filtradas pela % de compradores potenciais)
    const reelsIcp = reelsTotal * icpFactor;
    const storiesIcp = storiesTotal * icpFactor;
    const tiktokIcp = tiktokTotal * icpFactor;
    const totalViewsIcp = reelsIcp + storiesIcp + tiktokIcp;

    // Cliques calculados sobre views ICP
    const clicks = manualClicks > 0
      ? manualClicks
      : (reelsIcp * reelsCtr / 100) + (storiesIcp * storiesCtr / 100) + (tiktokIcp * tiktokCtr / 100);

    const ftd = manualFtd > 0 ? manualFtd : clicks * (cvrPercent / 100);
    const revenue = ftd * valueFtd;
    const roi = fee > 0 ? ((revenue - fee) / fee) * 100 : 0;
    const cpa = ftd > 0 ? fee / ftd : null;
    const profit = revenue - fee;
    const feeMaxLucro = revenue > 0 ? revenue : null;

    return { compradores, totalViews, totalViewsIcp, clicks, ftd, revenue, roi, cpa, profit, feeMaxLucro };
  }, [seguidores, percIcp, reelsQty, reelsViews, reelsCtr, storiesQty, storiesViews, storiesCtr, tiktokQty, tiktokViews, tiktokCtr, manualClicks, manualFtd, cvrPercent, valueFtd, fee]);

  const roiStatus = results.roi >= 200 ? "go" : results.roi >= 0 ? "warning" : "nogo";
  const profitStatus = results.profit > 0 ? "go" : results.profit < 0 ? "nogo" : undefined;

  const fetchProfile = async () => {
    if (!username.trim()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('instagram-profile', {
        body: { username: username.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setProfile(data);
      setSeguidores(data.followers);
      setReelsViews(data.avgReelsViews);
      setReelsCtr(data.estimatedCtr);
      setStoriesViews(data.storiesViewEstimate);
      setStoriesCtr(Math.round(data.estimatedCtr * 0.8 * 10) / 10);
      setReelsQty(data.videoCount > 0 ? Math.min(data.videoCount, 8) : 4);
      setStoriesQty(10);
      toast.success(`Perfil @${data.username} carregado!`, {
        description: `${fmtInt(data.followers)} seguidores · ${data.engagementRate.toFixed(2)}% engajamento`,
      });
    } catch (err: any) {
      console.error('Fetch profile error:', err);
      toast.error('Erro ao buscar perfil', { description: err.message });
    } finally {
      setLoading(false);
    }
  };


    const data = [
      ["Métrica", "Valor"],
      ["Seguidores", seguidores],
      ["% ICP", `${percIcp}%`],
      ["Compradores potenciais (ICP)", results.compradores],
      ["", ""],
      ["Reels - Qtd", reelsQty],
      ["Reels - Views médias", reelsViews],
      ["Reels - CTR", `${reelsCtr}%`],
      ["Stories - Qtd", storiesQty],
      ["Stories - Views médias", storiesViews],
      ["Stories - CTR", `${storiesCtr}%`],
      ["TikTok - Qtd", tiktokQty],
      ["TikTok - Views médias", tiktokViews],
      ["TikTok - CTR", `${tiktokCtr}%`],
      ["", ""],
      ["Views totais", results.totalViews],
      ["Views ICP", Math.round(results.totalViewsIcp)],
      ["Cliques estimados", Math.round(results.clicks)],
      ["FTD projetado", Math.round(results.ftd)],
      ["CVR para FTD", `${cvrPercent}%`],
      ["Valor por FTD", valueFtd],
      ["", ""],
      ["Fee / investimento", fee],
      ["Receita projetada", results.revenue],
      ["Lucro / Prejuízo", results.profit],
      ["ROI", `${results.roi.toFixed(1)}%`],
      ["CPA", results.cpa],
      ["Fee máximo para lucro", results.feeMaxLucro],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 30 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Instagram");
    XLSX.writeFile(wb, "analise-instagram.xlsx");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Inputs */}
      <div className="lg:col-span-2 space-y-6">
        {/* Profile Lookup */}
        <FieldSection title="Buscar perfil">
          <div className="flex gap-2">
            <Input
              placeholder="@username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchProfile()}
              className="font-mono"
            />
            <Button onClick={fetchProfile} disabled={loading} size="sm" className="shrink-0">
              {loading ? "Buscando…" : "Buscar"}
            </Button>
          </div>
          {profile && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50 border border-border mt-2">
              {profile.profilePicUrl && (
                <img src={profile.profilePicUrl} alt={profile.username} className="w-10 h-10 rounded-full" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-sm truncate">@{profile.username}</span>
                  {profile.isVerified && <span className="text-primary text-xs">✓</span>}
                </div>
                <span className="text-xs text-muted-foreground">
                  {fmtInt(profile.followers)} seg · {profile.engagementRate.toFixed(2)}% eng
                </span>
              </div>
            </div>
          )}
        </FieldSection>

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
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Resultados</h2>
          <Button variant="outline" size="sm" onClick={downloadExcel}>
            📥 Exportar Excel
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Views totais" value={fmtInt(results.totalViews)} />
          <MetricCard label="Views ICP" value={fmtInt(results.totalViewsIcp)} />
          <MetricCard label="Cliques estimados" value={fmtInt(results.clicks)} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="FTD projetado" value={fmtInt(results.ftd)} />
          <MetricCard label="Receita projetada" value={fmtMoney(results.revenue)} status={results.revenue > 0 ? "go" : undefined} />
          <MetricCard label="ROI" value={fee > 0 ? fmtPercent(results.roi, 0) : "-"} status={fee > 0 ? roiStatus : undefined} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="CPA" value={fee > 0 ? fmtMoney(results.cpa) : "-"} />
          <MetricCard
            label="Lucro / Prejuízo"
            value={fee > 0 ? fmtMoney(results.profit) : "-"}
            status={fee > 0 ? profitStatus : undefined}
          />
          <MetricCard
            label="Fee máximo p/ lucro"
            value={results.feeMaxLucro ? fmtMoney(results.feeMaxLucro) : "-"}
          />
        </div>
        {fee > 0 && (
          <StatusBadge status={results.profit > 0 ? "go" : results.profit === 0 ? "warning" : "nogo"} />
        )}
        <p className="text-xs text-muted-foreground mt-4">
          As views de cliques/FTD são calculadas sobre a audiência ICP (% aplicada às views). O fee máximo indica o valor máximo que você pode pagar para não ter prejuízo.
        </p>
      </div>
    </div>
  );
}
