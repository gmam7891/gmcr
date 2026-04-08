import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { MetricCard } from "@/components/MetricCard";
import { useLanguage } from "@/contexts/LanguageContext";
import { getChatStats } from "@/lib/scanner-api";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import type { ScannerFilters } from "./GlobalFilters";

interface Props {
  filters: ScannerFilters;
}

export function ChatSentimentTab({ filters }: Props) {
  const { t } = useLanguage();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getChatStats({
      streamer_login: filters.streamer || undefined,
      date_from: filters.date_from,
      date_to: filters.date_to,
    })
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [filters.streamer, filters.date_from, filters.date_to]);

  if (loading) return <p className="text-sm text-muted-foreground text-center py-8">{t("app.loading")}</p>;
  if (!stats || stats.total_messages === 0) return <p className="text-sm text-muted-foreground text-center py-8">{t("scan.no_data")}</p>;

  const sentimentData = [
    { name: t("scan.positive"), value: stats.sentiments?.positive || 0, color: "hsl(var(--chart-2))" },
    { name: t("scan.neutral"), value: stats.sentiments?.neutral || 0, color: "hsl(var(--muted-foreground))" },
    { name: t("scan.negative"), value: stats.sentiments?.negative || 0, color: "hsl(var(--destructive))" },
  ].filter(d => d.value > 0);

  const intentData = Object.entries(stats.intents || {}).map(([key, val]) => ({
    name: key.replace("_", " "),
    value: val as number,
  })).sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label={t("scan.messages_total")} value={stats.total_messages} />
        <MetricCard label={t("scan.positive")} value={stats.sentiments?.positive || 0} />
        <MetricCard label={t("scan.neutral")} value={stats.sentiments?.neutral || 0} />
        <MetricCard label={t("scan.negative")} value={stats.sentiments?.negative || 0} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">{t("scan.sentiment_dist")}</h3>
          {sentimentData.length > 0 ? (
            <div className="flex items-center gap-8">
              <ResponsiveContainer width={150} height={150}>
                <PieChart>
                  <Pie data={sentimentData} dataKey="value" innerRadius={40} outerRadius={65} paddingAngle={2}>
                    {sentimentData.map((d, i) => <Cell key={i} fill={d.color} />)}
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
          ) : <p className="text-xs text-muted-foreground text-center py-8">{t("scan.no_data")}</p>}
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Intent Distribution</h3>
          {intentData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={intentData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--chart-3))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-xs text-muted-foreground text-center py-8">{t("scan.no_data")}</p>}
        </Card>
      </div>
    </div>
  );
}
