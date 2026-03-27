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
  getKickChannel, getKickVideos, analyzeThumbnails,
  type KickChannel, type KickVideo, type GameDetection,
} from "@/lib/youtube-kick-api";

export function KickTab() {
  const { t, language } = useLanguage();
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [channel, setChannel] = useState<KickChannel | null>(null);
  const [videos, setVideos] = useState<KickVideo[]>([]);

  // Financial inputs
  const [fee, setFee] = useState(0);
  const [ctr, setCtr] = useState(0);
  const [cvr, setCvr] = useState(0);
  const [valueFtd, setValueFtd] = useState(0);
  const [avgViewers, setAvgViewers] = useState(0);
  const [plannedHours, setPlannedHours] = useState(0);

  // AI analysis
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
      } catch {
        // Kick videos API might fail
        setVideos([]);
      }
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
      toast.error("Erro na análise IA", { description: err.message });
    }
    setAiLoading(false);
  };

  const totalViews = videos.reduce((s, v) => s + v.viewCount, 0);

  const results = useMemo(() => {
    const viewerHours = avgViewers * plannedHours;
    const clicks = viewerHours * (ctr / 100);
    const ftd = clicks * (cvr / 100);
    const revenue = ftd * valueFtd;
    const roi = fee > 0 ? ((revenue - fee) / fee) * 100 : 0;
    const cpa = ftd > 0 ? fee / ftd : null;
    const profit = revenue - fee;
    return { viewerHours, clicks, ftd, revenue, roi, cpa, profit };
  }, [avgViewers, plannedHours, ctr, cvr, valueFtd, fee]);

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
      ["CTR", `${ctr}%`],
      ["CVR para FTD", `${cvr}%`],
      ["Valor por FTD", valueFtd],
      ["Fee", fee],
      [""],
      ["Viewer-hours (live)", results.viewerHours],
      ["Cliques", Math.round(results.clicks)],
      ["FTD", Math.round(results.ftd)],
      ["Receita", results.revenue],
      ["ROI", `${results.roi.toFixed(1)}%`],
      ["CPA", results.cpa],
      ["Lucro", results.profit],
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
        <FieldSection title="Buscar canal">
          <div className="flex gap-2">
            <Input
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchChannel()}
              className="font-mono"
            />
            <Button onClick={fetchChannel} disabled={loading} size="sm" className="shrink-0">
              {loading ? "Buscando…" : "Buscar"}
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
                <span className="text-xs text-muted-foreground">{fmtInt(channel.followers)} seguidores</span>
              </div>
            </div>
          )}
          {channel?.isLive && channel.livestream && (
            <div className="card-surface p-3 text-sm">
              <p className="font-medium">{channel.livestream.title}</p>
              <p className="text-xs text-muted-foreground">
                {fmtInt(channel.livestream.viewers)} viewers · {channel.livestream.category || 'N/A'}
              </p>
            </div>
          )}
        </FieldSection>

        <FieldSection title="Projeção financeira">
          <NumberField label="Avg viewers estimado" value={avgViewers} onChange={setAvgViewers} step={100} />
          <NumberField label="Horas contratadas (mês)" value={plannedHours} onChange={setPlannedHours} />
          <NumberField label="CTR" value={ctr} onChange={setCtr} step={0.1} suffix="%" />
          <NumberField label="CVR para FTD" value={cvr} onChange={setCvr} step={0.1} suffix="%" />
          <NumberField label="Valor por FTD" value={valueFtd} onChange={setValueFtd} step={50} suffix="R$" />
          <NumberField label="Fee / investimento" value={fee} onChange={setFee} step={1000} suffix="R$" />
        </FieldSection>
      </div>

      <div className="lg:col-span-3 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Resultados</h2>
          <Button variant="outline" size="sm" onClick={downloadExcel}>📥 Exportar Excel</Button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Viewer-hours (live)" value={fmtInt(results.viewerHours)} />
          <MetricCard label="Cliques estimados" value={fmtInt(results.clicks)} />
          <MetricCard label="FTD projetado" value={fmtInt(results.ftd)} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Receita projetada" value={fmtMoney(results.revenue)} status={results.revenue > 0 ? "go" : undefined} />
          <MetricCard label="ROI" value={fee > 0 ? fmtPercent(results.roi, 0) : "-"} status={fee > 0 ? (results.roi >= 200 ? "go" : results.roi >= 0 ? "warning" : "nogo") : undefined} />
          <MetricCard label="Lucro / Prejuízo" value={fee > 0 ? fmtMoney(results.profit) : "-"} status={fee > 0 ? (results.profit > 0 ? "go" : results.profit < 0 ? "nogo" : undefined) : undefined} />
        </div>
        {fee > 0 && <StatusBadge status={results.profit > 0 ? "go" : results.profit === 0 ? "warning" : "nogo"} />}

        {/* AI Analysis */}
        {videos.length > 0 && (
          <div className="flex items-center gap-3 pt-2">
            <Button variant="outline" size="sm" onClick={analyzeWithAI} disabled={aiLoading}>
              {aiLoading ? "🤖 Analisando..." : "🤖 Detectar jogos com IA"}
            </Button>
            <span className="text-xs text-muted-foreground">Analisa thumbnails dos VODs</span>
          </div>
        )}

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
            </div>
          </div>
        )}

        {/* VOD list */}
        {videos.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs text-muted-foreground uppercase tracking-wider">VODs ({videos.length})</h3>
            <div className="card-surface overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-3">Título</th>
                    <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Views</th>
                    <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.map((v) => (
                    <tr key={v.id} className="border-b border-border last:border-0 hover:bg-secondary/50 transition-colors">
                      <td className="p-3 text-sm max-w-[300px] truncate" title={v.title}>{v.title}</td>
                      <td className="p-3 text-right font-mono text-sm">{fmtInt(v.viewCount)}</td>
                      <td className="p-3 text-right font-mono text-xs text-muted-foreground">
                        {v.createdAt ? new Date(v.createdAt).toLocaleDateString("pt-BR") : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && !channel && (
          <div className="card-surface p-8 text-center text-muted-foreground text-sm">
            Busque um canal da Kick para iniciar a análise.
          </div>
        )}
      </div>
    </div>
  );
}
