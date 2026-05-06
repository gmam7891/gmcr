import { fmtInt } from "@/lib/formatters";
import type { TimelinePoint } from "@/lib/stream-monitor-api";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface Props {
  timeline: TimelinePoint[];
  rangeDays?: number;
}

export function ViewerTimeline({ timeline, rangeDays }: Props) {
  if (timeline.length === 0) return null;

  const games = [...new Set(timeline.map(t => t.game_name || 'Offline'))];
  const colors = [
    "hsl(var(--primary))",
    "hsl(var(--accent))",
    "hsl(var(--warning))",
    "hsl(var(--destructive))",
    "hsl(var(--secondary-foreground))",
  ];

  const startMs = new Date(timeline[0].captured_at).getTime();
  const endMs = new Date(timeline[timeline.length - 1].captured_at).getTime();
  const spanMs = Math.max(endMs - startMs, 1);
  const spanH = spanMs / 3600000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const days = rangeDays ?? Math.ceil(spanH / 24);
  // hour mode: 1d (HH:MM 00:00-23:59), 2d (HH:MM cycling twice), day mode: >=7d "Dia N"
  const mode: "hour" | "48h" | "day" = days <= 1 ? "hour" : days === 2 ? "48h" : "day";

  // Adaptive bucket size
  let bucketMs: number;
  if (mode === "hour") bucketMs = 5 * 60 * 1000;        // 5min
  else if (mode === "48h") bucketMs = 30 * 60 * 1000;   // 30min
  else if (days <= 7) bucketMs = 60 * 60 * 1000;        // 1h
  else if (days <= 14) bucketMs = 2 * 3600 * 1000;      // 2h
  else bucketMs = 6 * 3600 * 1000;                       // 6h

  type Bucket = { ts: number; sum: number; count: number; games: Record<string, number> };
  const buckets = new Map<number, Bucket>();
  for (const p of timeline) {
    const t = new Date(p.captured_at).getTime();
    const key = Math.floor(t / bucketMs) * bucketMs;
    let b = buckets.get(key);
    if (!b) { b = { ts: key, sum: 0, count: 0, games: {} }; buckets.set(key, b); }
    const v = p.is_live ? p.viewer_count : 0;
    b.sum += v;
    b.count += 1;
    const g = p.game_name || "Offline";
    b.games[g] = (b.games[g] || 0) + 1;
  }
  const sorted = [...buckets.values()].sort((a, b) => a.ts - b.ts);

  const axisDays = mode === "hour" ? 1 : mode === "48h" ? 2 : days;
  const axisEnd = Math.max(axisDays * DAY_MS - 60 * 1000, 1);
  const axisLabels =
    mode === "hour"
      ? ["00:00", "23:59"]
      : mode === "48h"
        ? ["00:00", "23:59", "00:00", "23:59"]
        : Array.from({ length: axisDays }, (_, i) => `Dia ${i + 1}`);
  const axisTicks = axisLabels.map((_, i) => (
    axisLabels.length === 1 ? 0 : (axisEnd / (axisLabels.length - 1)) * i
  ));

  const fmtAxisLabel = (value: number): string => {
    const nearestIndex = axisTicks.reduce((best, tick, i) => (
      Math.abs(tick - value) < Math.abs(axisTicks[best] - value) ? i : best
    ), 0);
    return axisLabels[nearestIndex] ?? "";
  };

  const fmtTooltipLabel = (x: number): string => {
    if (mode === "day") {
      return `Dia ${Math.min(axisDays, Math.max(1, Math.floor((x / axisEnd) * axisDays) + 1))}`;
    }
    const totalMinutes = Math.floor(((x / axisEnd) * axisDays * 24 * 60) % (24 * 60));
    const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const minutes = String(totalMinutes % 60).padStart(2, "0");
    return `${hours}:${minutes}`;
  };

  const data = sorted.map((b, idx) => {
    const dominantGame = Object.entries(b.games).sort((a, b) => b[1] - a[1])[0]?.[0] || "Offline";
    return {
      x: spanMs === 0 ? 0 : Math.min(axisEnd, Math.max(0, ((b.ts - startMs) / spanMs) * axisEnd)),
      ts: b.ts,
      viewers: Math.round(b.sum / Math.max(b.count, 1)),
      game: dominantGame,
    };
  });

  return (
    <div className="card-surface p-4 space-y-3">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Timeline de Viewers</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 10, bottom: mode === "day" && days > 14 ? 18 : 0, left: 0 }}>
            <defs>
              <linearGradient id="viewerGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="x"
              type="number"
              domain={[0, axisEnd]}
              ticks={axisTicks}
              tickFormatter={(value) => fmtAxisLabel(Number(value))}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              angle={mode === "day" && days > 14 ? -45 : 0}
              textAnchor={mode === "day" && days > 14 ? "end" : "middle"}
              height={mode === "day" && days > 14 ? 44 : 30}
              minTickGap={0}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => fmtInt(v)}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number) => [fmtInt(value), "Viewers"]}
              labelFormatter={(value) => fmtTooltipLabel(Number(value))}
            />
            <Area
              type="monotone"
              dataKey="viewers"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill="url(#viewerGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {games.filter(g => g !== "Offline").map((game, i) => (
          <div key={game} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: colors[i % colors.length] }} />
            <span>{game}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
