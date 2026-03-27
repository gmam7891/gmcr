import { fmtInt } from "@/lib/formatters";
import type { GameReach } from "@/lib/stream-monitor-api";

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

export function ReachTable({ reach }: { reach: GameReach[] }) {
  const maxImpressions = Math.max(...reach.map(r => r.totalViewerMinutes), 1);
  return (
    <div className="card-surface overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-3">Jogo / Categoria</th>
            <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Avg Viewers</th>
            <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Peak</th>
            <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Airtime</th>
            <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Viewer-Minutes</th>
            <th className="p-3 w-32">Reach</th>
          </tr>
        </thead>
        <tbody>
          {reach.map((r) => (
            <tr key={r.game} className="border-b border-border last:border-0 hover:bg-secondary/50 transition-colors">
              <td className="p-3 text-sm font-medium text-foreground">{r.game}</td>
              <td className="p-3 text-right font-mono text-sm">{fmtInt(r.avgViewers)}</td>
              <td className="p-3 text-right font-mono text-sm">{fmtInt(r.peakViewers)}</td>
              <td className="p-3 text-right font-mono text-sm text-muted-foreground">{formatMinutes(r.totalMinutes)}</td>
              <td className="p-3 text-right font-mono text-sm text-accent">{fmtInt(r.totalViewerMinutes)}</td>
              <td className="p-3">
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${(r.totalViewerMinutes / maxImpressions) * 100}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
