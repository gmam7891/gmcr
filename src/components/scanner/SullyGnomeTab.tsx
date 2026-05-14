import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Search, ExternalLink, AlertTriangle, BarChart3 } from "lucide-react";

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "#8884d8",
  "#82ca9d",
  "#ffc658",
];

interface GameStat {
  category: string;
  streamTimeRaw: string;
  streamTimeMinutes: number;
  avgViewers: number;
  peakViewers: number;
  hoursWatched: number;
  streamsCount: number;
  percentage: number;
  gamesId?: number;
  gamesLogo?: string;
}

interface RankItem {
  value: string | null;
  deltaSign: "up" | "down" | null;
  deltaValue: string | null;
}

interface ChannelHeader {
  followers: string | null;
  status: string | null;
  mature: string | null;
  language: string | null;
  created: string | null;
  lastOnline: string | null;
  ranks: {
    peakViewer: RankItem;
    avgViewer: RankItem;
    follower: RankItem;
    followerGain: RankItem;
  };
}

interface PeriodStat {
  label: string;
  value: string;
  delta: string | null;
  deltaSign: "up" | "down" | null;
  deltaPct: string | null;
}

interface StreamRow {
  streamId: number;
  startTime: string;
  startDateTime: string;
  endTime: string;
  lengthMinutes: number;
  avgViewers: number;
  peakViewers: number;
  watchHours: number;
  followerGain: number;
  games: { name: string; slug: string; logo: string }[];
  streamUrl: string;
}

interface SullyResult {
  streamer: string;
  channelId?: string;
  source: string;
  period: string;
  header?: ChannelHeader;
  periodStats?: PeriodStat[];
  streams?: StreamRow[];
  gameStats: GameStat[];
  summary: {
    totalCategories: number;
    totalStreamMinutes: number;
    casinoStreamMinutes: number;
    casinoPercentage: number;
    topCategory: string;
    casinoCategories: string[];
  };
}

interface Props {
  aiDetections?: { game_name: string; exposure_seconds: number }[];
}

const CASINO_KEYWORDS = ["virtual casino", "slots", "casino", "gambling"];

export function SullyGnomeTab({ aiDetections = [] }: Props) {
  const { t } = useLanguage();
  const [streamer, setStreamer] = useState("");
  const [period, setPeriod] = useState("30");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SullyResult | null>(null);

  const handleSearch = async () => {
    const login = streamer.trim().toLowerCase();
    if (!login) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("sullygnome-scraper", {
        body: { action: "scrape", streamer_login: login, period: Number(period) },
      });
      if (error) throw error;
      if (data?.error) {
        const stage = data.stage ? ` [${data.stage}]` : "";
        throw new Error(`${data.error}${stage}`);
      }
      setResult(data);
      toast({ title: t("sully.success"), description: `${data.gameStats?.length || 0} ${t("sully.categories_found")}` });
    } catch (e: any) {
      console.error("SullyGnome error:", e);
      toast({ title: t("sully.error"), description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const pieData = (result?.gameStats || [])
    .filter((g) => g.percentage > 0)
    .slice(0, 8)
    .map((g) => ({ name: g.category, value: g.streamTimeMinutes }));

  const discrepancyData = (result?.gameStats || [])
    .filter((g) => CASINO_KEYWORDS.some((kw) => g.category.toLowerCase().includes(kw)))
    .map((g) => {
      const aiMatch = aiDetections.find(
        (d) => d.game_name && g.category.toLowerCase().includes(d.game_name.toLowerCase())
      );
      const aiMinutes = aiMatch ? Math.round(aiMatch.exposure_seconds / 60) : 0;
      return {
        category: g.category,
        sullyMinutes: g.streamTimeMinutes,
        aiMinutes,
        diff: g.streamTimeMinutes - aiMinutes,
        diffPercent: g.streamTimeMinutes > 0 ? Math.round(((g.streamTimeMinutes - aiMinutes) / g.streamTimeMinutes) * 100) : 0,
      };
    });

  const formatMinutes = (m: number) => {
    if (m >= 1440) return `${Math.round(m / 1440)}d ${Math.round((m % 1440) / 60)}h`;
    if (m >= 60) return `${Math.round(m / 60)}h ${m % 60}m`;
    return `${m}m`;
  };

  const formatLogo = (url?: string) => {
    if (!url) return "";
    return url.replace(/\{width\}/g, "20").replace(/\{height\}/g, "27");
  };

  const isCasino = (cat: string) =>
    CASINO_KEYWORDS.some((kw) => cat.toLowerCase().includes(kw));

  return (
    <div className="space-y-6">
      {/* Search */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider">{t("sully.title")}</h2>
          <Badge variant="secondary" className="text-[9px] font-mono">SullyGnome</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{t("sully.subtitle")}</p>
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder={t("sully.placeholder")}
            value={streamer}
            onChange={(e) => setStreamer(e.target.value)}
            className="max-w-xs text-sm"
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[130px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 dias</SelectItem>
              <SelectItem value="30">30 dias</SelectItem>
              <SelectItem value="90">90 dias</SelectItem>
              <SelectItem value="365">1 ano</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleSearch} disabled={loading || !streamer.trim()} size="sm" className="gap-1.5">
            <Search className="h-3.5 w-3.5" />
            {loading ? t("app.searching") : t("sully.search_btn")}
          </Button>
          {result && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={`https://sullygnome.com/channel/${result.streamer}/${period}/games`}
                target="_blank"
                rel="noopener noreferrer"
                className="gap-1.5"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                SullyGnome
              </a>
            </Button>
          )}
        </div>
      </Card>

      {result && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("sully.total_categories")}</p>
              <p className="text-xl font-bold font-mono">{result.summary.totalCategories}</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("sully.total_stream")}</p>
              <p className="text-xl font-bold font-mono">{formatMinutes(result.summary.totalStreamMinutes)}</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("sully.casino_time")}</p>
              <p className="text-xl font-bold font-mono text-primary">{formatMinutes(result.summary.casinoStreamMinutes)}</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("sully.casino_pct")}</p>
              <p className={`text-xl font-bold font-mono ${result.summary.casinoPercentage > 30 ? "text-destructive" : "text-accent"}`}>
                {result.summary.casinoPercentage}%
              </p>
            </Card>
          </div>

          {/* Pie Chart + Table */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">{t("sully.time_distribution")}</h3>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => formatMinutes(v)}
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        color: "hsl(var(--popover-foreground))",
                        fontSize: 12,
                        boxShadow: "0 12px 30px hsl(var(--background) / 0.35)",
                      }}
                      labelStyle={{ color: "hsl(var(--popover-foreground))", fontWeight: 600 }}
                      itemStyle={{ color: "hsl(var(--popover-foreground))" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-8">{t("sully.no_data")}</p>
              )}
              <div className="flex flex-wrap gap-2 mt-2">
                {pieData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-1 text-[10px]">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-muted-foreground">{d.name}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">{t("sully.game_stats")}</h3>
              <div className="max-h-[300px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px]">{t("sully.category")}</TableHead>
                      <TableHead className="text-[10px]">{t("sully.stream_time")}</TableHead>
                      <TableHead className="text-[10px]">{t("sully.avg_viewers")}</TableHead>
                      <TableHead className="text-[10px]">Pico</TableHead>
                      <TableHead className="text-[10px]">Lives</TableHead>
                      <TableHead className="text-[10px]">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.gameStats.map((g, i) => {
                      const casino = isCasino(g.category);
                      return (
                        <TableRow key={i} className={casino ? "bg-destructive/5" : undefined}>
                          <TableCell className="text-xs font-medium">
                            <div className="flex items-center gap-1.5">
                              {g.gamesLogo && (
                                <img
                                  src={formatLogo(g.gamesLogo)}
                                  alt=""
                                  width={20}
                                  height={27}
                                  className="rounded-sm flex-shrink-0"
                                  loading="lazy"
                                />
                              )}
                              <span>{g.category}</span>
                              {casino && (
                                <Badge variant="destructive" className="ml-1 text-[8px]">cassino</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs font-mono">{formatMinutes(g.streamTimeMinutes)}</TableCell>
                          <TableCell className="text-xs font-mono">{g.avgViewers.toLocaleString()}</TableCell>
                          <TableCell className="text-xs font-mono">{g.peakViewers.toLocaleString()}</TableCell>
                          <TableCell className="text-xs font-mono">{g.streamsCount}</TableCell>
                          <TableCell className="text-xs font-mono">{g.percentage}%</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </div>

          {/* Discrepancy Analysis */}
          {discrepancyData.length > 0 && (
            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <h3 className="text-sm font-semibold">{t("sully.discrepancy_title")}</h3>
              </div>
              <p className="text-xs text-muted-foreground">{t("sully.discrepancy_desc")}</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">{t("sully.category")}</TableHead>
                    <TableHead className="text-[10px]">SullyGnome</TableHead>
                    <TableHead className="text-[10px]">{t("sully.ai_detection")}</TableHead>
                    <TableHead className="text-[10px]">{t("sully.diff")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {discrepancyData.map((d, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium">{d.category}</TableCell>
                      <TableCell className="text-xs font-mono">{formatMinutes(d.sullyMinutes)}</TableCell>
                      <TableCell className="text-xs font-mono">{formatMinutes(d.aiMinutes)}</TableCell>
                      <TableCell className={`text-xs font-mono font-bold ${d.diffPercent > 20 ? "text-destructive" : d.diffPercent < -20 ? "text-accent" : "text-foreground"}`}>
                        {d.diffPercent > 0 ? "+" : ""}{d.diffPercent}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
