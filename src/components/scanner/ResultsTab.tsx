import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useLanguage } from "@/contexts/LanguageContext";
import { getResultsAggregated } from "@/lib/scanner-api";
import { MetricCard } from "@/components/MetricCard";
import { Download, FileText } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { ScannerFilters } from "./GlobalFilters";

interface Props { filters: ScannerFilters; }

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTimestamp(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function ResultsTab({ filters }: Props) {
  const { t } = useLanguage();
  const [groupBy, setGroupBy] = useState<"game" | "vod" | "streamer_game">("game");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getResultsAggregated({
      streamer: filters.streamer || undefined,
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
      group_by: groupBy,
      block_status_filter: "confirmed",
    })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filters.streamer, filters.date_from, filters.date_to, groupBy]);

  const aggregated = data?.aggregated || [];
  const totals = data?.totals || {};
  const blocks = data?.blocks || [];

  const chartData = useMemo(
    () => aggregated.slice(0, 10).map((a: any) => ({
      name: a.game.length > 14 ? a.game.slice(0, 14) + "…" : a.game,
      minutes: a.exposure_minutes,
    })),
    [aggregated]
  );

  const exportCSV = () => {
    const header = ["Jogo", "Provedora", "Exposição (min)", "Sessões", "VODs", "Streamers", "Confiança média (%)"];
    const rows = aggregated.map((a: any) => [
      a.game, a.provider, a.exposure_minutes, a.sessions, a.vods_count, a.streamers_count,
      ((a.avg_confidence <= 1 ? a.avg_confidence * 100 : a.avg_confidence)).toFixed(1),
    ]);
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `resultados-jogos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const exportBlocksCSV = () => {
    const header = ["VOD", "Streamer", "Jogo", "Provedora", "Início", "Fim", "Duração (s)", "Confiança", "Status"];
    const rows = blocks.map((b: any) => [
      b.vod_id, b.streamer_login, b.game_name || "—", b.provider_name || "—",
      formatTimestamp(b.start_seconds), formatTimestamp(b.end_seconds), b.duration_seconds,
      ((b.confidence_avg <= 1 ? b.confidence_avg * 100 : b.confidence_avg)).toFixed(0) + "%",
      b.status,
    ]);
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `blocos-detalhados-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  if (loading) return <p className="text-sm text-muted-foreground text-center py-8">{t("app.loading")}</p>;
  if (!aggregated.length) return <p className="text-sm text-muted-foreground text-center py-8">{t("scan.no_data")}</p>;

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard label="Jogos únicos" value={totals.games || 0} />
        <MetricCard label="Blocos detectados" value={totals.blocks || 0} />
        <MetricCard label="Tempo total" value={formatDuration(totals.exposure_seconds || 0)} />
        <MetricCard label="VODs" value={totals.vods || 0} />
        <MetricCard label="Streamers" value={totals.streamers || 0} />
      </div>

      {/* Top 10 chart */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Top 10 jogos por tempo de exposição</h3>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportCSV}>
              <Download className="h-3 w-3 mr-1" /> Agregado CSV
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportBlocksCSV}>
              <FileText className="h-3 w-3 mr-1" /> Blocos CSV
            </Button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} label={{ value: "min", angle: -90, position: "insideLeft", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
            <Bar dataKey="minutes" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Tabs: agrupamento + detalhe */}
      <Tabs defaultValue="aggregated" className="space-y-3">
        <TabsList className="bg-secondary/50 border border-border">
          <TabsTrigger value="aggregated" className="text-xs font-mono uppercase tracking-wider">Agregado</TabsTrigger>
          <TabsTrigger value="blocks" className="text-xs font-mono uppercase tracking-wider">Blocos detalhados</TabsTrigger>
        </TabsList>

        <TabsContent value="aggregated">
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Agrupar por:</span>
              {([["game", "Jogo"], ["streamer_game", "Streamer × Jogo"], ["vod", "VOD × Jogo"]] as const).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setGroupBy(v)}
                  className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded transition-colors ${
                    groupBy === v ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Jogo</TableHead>
                  <TableHead>Provedora</TableHead>
                  <TableHead className="text-right">Tempo total</TableHead>
                  <TableHead className="text-right">Sessões</TableHead>
                  <TableHead className="text-right">VODs</TableHead>
                  <TableHead className="text-right">Streamers</TableHead>
                  <TableHead className="text-right">Confiança</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aggregated.map((a: any) => {
                  const conf = a.avg_confidence <= 1 ? a.avg_confidence * 100 : a.avg_confidence;
                  return (
                    <TableRow key={a.key}>
                      <TableCell className="text-sm font-medium">{a.game}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{a.provider}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatDuration(a.exposure_seconds)}</TableCell>
                      <TableCell className="text-right text-xs">{a.sessions}</TableCell>
                      <TableCell className="text-right text-xs">{a.vods_count}</TableCell>
                      <TableCell className="text-right text-xs">{a.streamers_count}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        <span className={conf < 60 ? "text-destructive" : conf < 80 ? "text-yellow-600" : "text-green-600"}>
                          {Math.round(conf)}%
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="blocks">
          <Card className="p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>VOD</TableHead>
                  <TableHead>Streamer</TableHead>
                  <TableHead>Jogo</TableHead>
                  <TableHead>Provedora</TableHead>
                  <TableHead className="text-right">Início</TableHead>
                  <TableHead className="text-right">Fim</TableHead>
                  <TableHead className="text-right">Duração</TableHead>
                  <TableHead className="text-right">Confiança</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blocks.map((b: any) => {
                  const conf = b.confidence_avg <= 1 ? b.confidence_avg * 100 : b.confidence_avg;
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono text-[10px]">{b.vod_id}</TableCell>
                      <TableCell className="text-xs">{b.streamer_login}</TableCell>
                      <TableCell className="text-sm font-medium">{b.game_name || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{b.provider_name || "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatTimestamp(b.start_seconds)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatTimestamp(b.end_seconds)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatDuration(b.duration_seconds)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{Math.round(conf)}%</TableCell>
                      <TableCell>
                        <Badge className="text-[10px] bg-green-500/20 text-green-600">{b.status}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
