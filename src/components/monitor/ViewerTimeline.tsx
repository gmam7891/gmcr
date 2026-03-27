import { fmtInt } from "@/lib/formatters";
import type { TimelinePoint } from "@/lib/stream-monitor-api";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

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

  const data = timeline.map((point, i) => ({
    time: new Date(point.captured_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    viewers: point.is_live ? point.viewer_count : 0,
    game: point.game_name || "Offline",
    isLive: point.is_live,
  }));

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
              interval="preserveStartEnd"
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
              formatter={(value: number, name: string) => [fmtInt(value), "Viewers"]}
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
