import { Card } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { MetricCard } from "@/components/MetricCard";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

interface Props {
  data: any;
  providers: any[];
  games: any[];
}

const COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "#8884d8", "#82ca9d", "#ffc658"];

export function DashboardTab({ data, providers, games }: Props) {
  const { t } = useLanguage();

  if (!data) return <p className="text-sm text-muted-foreground text-center py-12">{t("scan.no_data")}</p>;

  const exposureHours = Math.round((data.total_exposure_seconds || 0) / 3600 * 10) / 10;
  const viewerMinK = Math.round((data.total_viewer_minutes || 0) / 1000);

  // Provider chart data
  const providerLookup: Record<string, string> = {};
  providers.forEach((p: any) => { providerLookup[p.id] = p.name; });
  const providerChartData = Object.entries(data.provider_share || {})
    .map(([id, val]) => ({ name: providerLookup[id] || id.slice(0, 8), value: val as number }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  // Game chart data
  const gameLookup: Record<string, string> = {};
  games.forEach((g: any) => { gameLookup[g.id] = g.name; });
  const gameChartData = Object.entries(data.game_share || {})
    .map(([id, val]) => ({ name: gameLookup[id] || id.slice(0, 8), value: val as number }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  // Sentiment
  const sentimentData = [
    { name: t("scan.positive"), value: data.chat_sentiment?.positive || 0, color: "hsl(var(--chart-2))" },
    { name: t("scan.neutral"), value: data.chat_sentiment?.neutral || 0, color: "hsl(var(--muted-foreground))" },
    { name: t("scan.negative"), value: data.chat_sentiment?.negative || 0, color: "hsl(var(--destructive))" },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard label={t("scan.total_exposure")} value={`${exposureHours}h`} />
        <MetricCard label={t("scan.total_viewer_min")} value={`${viewerMinK}k`} />
        <MetricCard label={t("scan.unique_streamers")} value={data.unique_streamers || 0} />
        <MetricCard label={t("scan.total_detections")} value={data.total_detections || 0} />
        <MetricCard label={t("scan.avg_coverage")} value={`${Math.round(data.avg_vod_coverage || 0)}%`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">{t("scan.provider_share")}</h3>
          {providerChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={providerChartData} layout="vertical">
                <XAxis type="number" tickFormatter={v => `${Math.round(v / 3600)}h`} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => `${Math.round(v / 3600 * 10) / 10}h`} />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-xs text-muted-foreground text-center py-8">{t("scan.no_data")}</p>}
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">{t("scan.game_share")}</h3>
          {gameChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={gameChartData} layout="vertical">
                <XAxis type="number" tickFormatter={v => `${Math.round(v / 3600)}h`} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => `${Math.round(v / 3600 * 10) / 10}h`} />
                <Bar dataKey="value" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-xs text-muted-foreground text-center py-8">{t("scan.no_data")}</p>}
        </Card>
      </div>

      {sentimentData.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">{t("scan.sentiment_dist")}</h3>
          <div className="flex items-center gap-8">
            <ResponsiveContainer width={150} height={150}>
              <PieChart>
                <Pie data={sentimentData} dataKey="value" innerRadius={40} outerRadius={65} paddingAngle={2}>
                  {sentimentData.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {sentimentData.map(d => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
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
