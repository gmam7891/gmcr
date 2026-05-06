import { fmtInt } from "@/lib/formatters";
import type { TimelinePoint } from "@/lib/stream-monitor-api";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface Props {
  timeline: TimelinePoint[];
}

export function ViewerTimeline({ timeline }: Props) {
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

  // Adaptive bucket size: target ~120 buckets max
  let bucketMs: number;
  if (spanH <= 26) bucketMs = 5 * 60 * 1000;          // <=24h: 5min
  else if (spanH <= 50) bucketMs = 15 * 60 * 1000;     // <=2d:  15min
  else if (spanH <= 24 * 8) bucketMs = 60 * 60 * 1000; // <=7d:  1h
  else if (spanH <= 24 * 15) bucketMs = 2 * 3600 * 1000; // <=14d: 2h
  else bucketMs = 6 * 3600 * 1000;                      // 30d:   6h

  const multiDay = spanH > 36;

  // Aggregate snapshots into buckets (avg viewers per bucket, dominant game)
  type Bucket = { ts: number; sum: number; count: number; live: number; games: Record<string, number> };
  const buckets = new Map<number, Bucket>();
  for (const p of timeline) {
    const t = new Date(p.captured_at).getTime();
    const key = Math.floor(t / bucketMs) * bucketMs;
    let b = buckets.get(key);
    if (!b) { b = { ts: key, sum: 0, count: 0, live: 0, games: {} }; buckets.set(key, b); }
    const v = p.is_live ? p.viewer_count : 0;
    b.sum += v;
    b.count += 1;
    if (p.is_live) b.live += 1;
    const g = p.game_name || "Offline";
    b.games[g] = (b.games[g] || 0) + 1;
  }

  const sorted = [...buckets.values()].sort((a, b) => a.ts - b.ts);
  const fmt = (ts: number) => {
    const d = new Date(ts);
    if (multiDay) {
      return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const data = sorted.map(b => {
    const dominantGame = Object.entries(b.games).sort((a, b) => b[1] - a[1])[0]?.[0] || "Offline";
    return {
      time: fmt(b.ts),
      viewers: Math.round(b.sum / Math.max(b.count, 1)),
      game: dominantGame,
    };
  });

  // Limit X-axis tick density
  const tickCount = Math.min(10, data.length);
  const tickInterval = data.length > tickCount ? Math.floor(data.length / tickCount) : 0;

  return (
    <div className="card-surface p-4 space-y-3">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Timeline de Viewers</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="viewerGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              interval={tickInterval}
              minTickGap={20}
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
              labelFormatter={(label) => `${label}`}
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
