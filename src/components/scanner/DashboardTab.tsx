import { Card } from "@/components/ui/card";
import { useEffect, useState, useMemo } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { MetricCard } from "@/components/MetricCard";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, Cell as RCell } from "recharts";
import { TrendingUp, TrendingDown, Minus, Sparkles } from "lucide-react";
import { getTrendWeekly } from "@/lib/scanner-api";
import { useScannerFilters } from "@/contexts/ScannerFiltersContext";

interface Props {
  data: any;
  providers: any[];
  games: any[];
}

const fmtH = (s: number) => `${Math.round((s || 0) / 3600 * 10) / 10}h`;

export function DashboardTab({ data, providers, games }: Props) {
  const { t } = useLanguage();
  const { filters } = useScannerFilters();
  const [trend, setTrend] = useState<any[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);

  useEffect(() => {
    setTrendLoading(true);
    getTrendWeekly({
      date_to: filters.date_to,
      streamers: filters.streamers,
      provider_ids: filters.provider_ids,
      platform: filters.platform || undefined,
    })
      .then((r) => setTrend(r?.trend || []))
      .catch(() => setTrend([]))
      .finally(() => setTrendLoading(false));
  }, [filters.date_to, filters.streamers, filters.provider_ids, filters.platform]);

  const exposureSec = data?.total_exposure_seconds || 0;
  const exposureHours = Math.round(exposureSec / 3600 * 10) / 10;
  const viewerMinK = Math.round((data?.total_viewer_minutes || 0) / 1000);

  const providerLookup: Record<string, string> = {};
  providers.forEach((p: any) => { providerLookup[p.id] = p.name; });
  const gameLookup: Record<string, string> = {};
  games.forEach((g: any) => { gameLookup[g.id] = g.name; });

  const providerEntries = Object.entries(data?.provider_share || {})
    .map(([id, val]) => ({ name: providerLookup[id] || id, value: val as number }))
    .sort((a, b) => b.value - a.value);
  const gameEntries = Object.entries(data?.game_share || {})
    .map(([id, val]) => ({ name: gameLookup[id] || id, value: val as number }))
    .sort((a, b) => b.value - a.value);

  // ───── Veredito Dinâmico (must be before any early return) ─────
  const verdict = useMemo(() => {
    if (!exposureSec) return null;
    const topProv = providerEntries[0];
    const topGame = gameEntries[0];
    const provPct = topProv ? Math.round((topProv.value / exposureSec) * 100) : 0;
    const gamePct = topGame ? Math.round((topGame.value / exposureSec) * 100) : 0;

    const subject = filters.streamers?.length === 1
      ? filters.streamers[0]
      : (filters.streamer || ((data?.unique_streamers || 0) > 1 ? `${data?.unique_streamers} streamers` : "o painel"));

    const periodo = `${filters.date_from} → ${filters.date_to}`;

    return {
      subject, periodo,
      topProv: topProv?.name, provPct,
      topGame: topGame?.name, gamePct,
      hours: exposureHours,
    };
  }, [exposureSec, providerEntries, gameEntries, filters, data?.unique_streamers, exposureHours]);

  if (!data) return <p className="text-xs text-muted-foreground text-center py-12">{t("scan.no_data")}</p>;

  const sentimentData = [
    { name: t("scan.positive"), value: data.chat_sentiment?.positive || 0, color: "hsl(var(--chart-2))" },
    { name: t("scan.neutral"), value: data.chat_sentiment?.neutral || 0, color: "hsl(var(--muted-foreground))" },
    { name: t("scan.negative"), value: data.chat_sentiment?.negative || 0, color: "hsl(var(--destructive))" },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-3">
      {/* ───── Veredito Dinâmico ───── */}
      {verdict && (
        <Card className="p-3 bg-gradient-to-r from-primary/5 via-background to-background border-primary/20">
          <div className="flex items-start gap-2">
            <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="space-y-1 min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Veredito do período</p>
              <p className="text-sm leading-snug text-foreground">
                No período <span className="font-mono text-primary">{verdict.periodo}</span>,{" "}
                <span className="font-semibold">{verdict.subject}</span> acumulou{" "}
                <span className="font-mono text-primary">{verdict.hours}h</span> de exposição
                {verdict.topProv && (
                  <>, com <span className="font-mono text-primary">{verdict.provPct}%</span> dedicado à provedora{" "}
                  <span className="font-semibold">{verdict.topProv}</span></>
                )}
                {verdict.topGame && (
                  <>, com foco no jogo <span className="font-semibold">{verdict.topGame}</span>{" "}
                  (<span className="font-mono">{verdict.gamePct}%</span>)</>
                )}.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ───── KPIs ───── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <MetricCard label={t("scan.total_exposure")} value={`${exposureHours}h`} />
        <MetricCard label={t("scan.total_viewer_min")} value={`${viewerMinK}k`} />
        <MetricCard label={t("scan.unique_streamers")} value={data.unique_streamers || 0} />
        <MetricCard label={t("scan.total_detections")} value={data.total_detections || 0} />
        <MetricCard label={t("scan.avg_coverage")} value={`${Math.round(data.avg_vod_coverage || 0)}%`} />
      </div>

      {/* ───── Trend Semanal ───── */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider">Trend semanal por provedora</h3>
            <p className="text-[10px] text-muted-foreground font-mono">7 dias atuais vs 7 dias anteriores · share de tela em horas</p>
          </div>
        </div>
        {trendLoading ? (
          <p className="text-[10px] text-muted-foreground text-center py-8 font-mono">carregando…</p>
        ) : trend.length === 0 ? (
          <p className="text-[10px] text-muted-foreground text-center py-8 font-mono">{t("scan.no_data")}</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trend.map(t => ({ name: t.name, atual: Math.round((t.current || 0) / 3600 * 10) / 10, anterior: Math.round((t.previous || 0) / 3600 * 10) / 10 }))} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" height={50} interval={0} />
                <YAxis tickFormatter={(v) => `${v}h`} tick={{ fontSize: 9 }} />
                <Tooltip formatter={(v: number) => `${v}h`} contentStyle={{ fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="anterior" fill="hsl(var(--muted-foreground))" radius={[2, 2, 0, 0]} />
                <Bar dataKey="atual" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            {/* Top movers chips */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {trend.slice(0, 6).map((mv) => {
                const up = mv.delta > 0;
                const flat = mv.delta === 0;
                const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
                const color = flat ? "text-muted-foreground" : up ? "text-emerald-500" : "text-destructive";
                return (
                  <div key={mv.name} className={`flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border border-border bg-secondary/40 ${color}`}>
                    <Icon className="h-3 w-3" />
                    <span className="text-foreground">{mv.name}</span>
                    <span>{up ? "+" : ""}{Math.round(mv.delta_pct)}%</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {/* ───── Provider + Game share ───── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2">{t("scan.provider_share")}</h3>
          {providerEntries.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={providerEntries.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <XAxis type="number" tickFormatter={v => `${Math.round(v / 3600)}h`} tick={{ fontSize: 9 }} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 9 }} />
                <Tooltip formatter={(v: number) => fmtH(v)} contentStyle={{ fontSize: 11 }} />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-[10px] text-muted-foreground text-center py-6 font-mono">{t("scan.no_data")}</p>}
        </Card>

        <Card className="p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2">{t("scan.game_share")}</h3>
          {gameEntries.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={gameEntries.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <XAxis type="number" tickFormatter={v => `${Math.round(v / 3600)}h`} tick={{ fontSize: 9 }} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 9 }} />
                <Tooltip formatter={(v: number) => fmtH(v)} contentStyle={{ fontSize: 11 }} />
                <Bar dataKey="value" fill="hsl(var(--chart-2))" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-[10px] text-muted-foreground text-center py-6 font-mono">{t("scan.no_data")}</p>}
        </Card>
      </div>

      {/* ───── IA vs Twitch ───── */}
      {Array.isArray(data.ai_vs_twitch) && data.ai_vs_twitch.length > 0 && (
        <Card className="p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider">IA vs Categoria oficial Twitch</h3>
          <p className="text-[10px] text-muted-foreground font-mono mb-2">Detecção visual da IA vs chapters declarados pelo streamer.</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.ai_vs_twitch.map((d: any) => ({
              name: d.name,
              IA: Math.round((d.ai_seconds || 0) / 60),
              Twitch: Math.round((d.twitch_seconds || 0) / 60),
            }))} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-15} textAnchor="end" height={50} interval={0} />
              <YAxis tickFormatter={(v) => `${v}m`} tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v: number) => `${v} min`} contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="IA" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Twitch" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {sentimentData.length > 0 && (
        <Card className="p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2">{t("scan.sentiment_dist")}</h3>
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={130} height={130}>
              <PieChart>
                <Pie data={sentimentData} dataKey="value" innerRadius={32} outerRadius={55} paddingAngle={2}>
                  {sentimentData.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5">
              {sentimentData.map(d => (
                <div key={d.name} className="flex items-center gap-2 text-[11px] font-mono">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                  <span>{d.name}: {d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
