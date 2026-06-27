import { useEffect, useState } from "react";
import { fetchVodChapters, type VodChaptersResult } from "@/lib/fetchVodChapters";

export interface ViewerSample {
  offsetMs: number;
  viewers: number;
}

interface CategoryAggregate {
  game: string;
  airtimeMs: number;
  pctOfVod: number;
  viewerHours: number | null;
  segmentCount: number;
  isCasino: boolean;
  color: string;
}

interface VodCategoryTimelineProps {
  videoId: string;
  viewerSeries?: ViewerSample[];
  avgViewers?: number;
}

const CASINO_KEYWORDS = ["slot", "casino", "cassino", "poker", "roulette", "blackjack", "betting", "gambl"];

const PALETTE = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6",
  "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#84cc16",
];

function isCasinoCategory(name: string | null): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return CASINO_KEYWORDS.some((k) => n.includes(k));
}

function formatHms(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function formatHours(h: number): string {
  return h >= 10 ? h.toFixed(0) : h.toFixed(1);
}

function viewerHoursForRange(series: ViewerSample[], startMs: number, endMs: number): number | null {
  if (!series.length || endMs <= startMs) return null;
  const sorted = [...series].sort((a, b) => a.offsetMs - b.offsetMs);

  const viewersAt = (t: number): number => {
    if (t <= sorted[0].offsetMs) return sorted[0].viewers;
    if (t >= sorted[sorted.length - 1].offsetMs) return sorted[sorted.length - 1].viewers;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      if (t >= a.offsetMs && t <= b.offsetMs) {
        if (b.offsetMs === a.offsetMs) return a.viewers;
        const ratio = (t - a.offsetMs) / (b.offsetMs - a.offsetMs);
        return a.viewers + ratio * (b.viewers - a.viewers);
      }
    }
    return sorted[sorted.length - 1].viewers;
  };

  const inner = sorted.map((s) => s.offsetMs).filter((t) => t > startMs && t < endMs);
  const points = [startMs, ...inner, endMs];
  let areaViewerMs = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const t0 = points[i], t1 = points[i + 1];
    areaViewerMs += ((viewersAt(t0) + viewersAt(t1)) / 2) * (t1 - t0);
  }
  return areaViewerMs / 3_600_000;
}

export function VodCategoryTimeline({ videoId, viewerSeries, avgViewers }: VodCategoryTimelineProps) {
  const [data, setData] = useState<VodChaptersResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchVodChapters(videoId)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [videoId]);

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Carregando capítulos da VOD…</div>;
  if (error) return <div className="p-4 text-sm text-destructive">Erro: {error}</div>;
  if (!data) return null;

  if (!data.hasChapters) {
    return (
      <div className="p-4 rounded-lg border bg-muted/30 text-sm">
        Esta VOD tem uma única categoria do início ao fim — o streamer não trocou de categoria,
        então não há quebra por capítulo. A subdivisão por jogo aparece na aba iGaming (detecção visual).
      </div>
    );
  }

  const categoryColors = new Map<string, string>();
  let colorIdx = 0;
  for (const seg of data.segments) {
    const key = seg.game ?? "—";
    if (!categoryColors.has(key)) {
      categoryColors.set(key, PALETTE[colorIdx % PALETTE.length]);
      colorIdx++;
    }
  }

  const aggMap = new Map<string, CategoryAggregate>();
  for (const seg of data.segments) {
    const key = seg.game ?? "—";
    const segViewerHours = viewerSeries?.length
      ? viewerHoursForRange(viewerSeries, seg.startMs, seg.endMs)
      : null;
    const existing = aggMap.get(key);
    if (existing) {
      existing.airtimeMs += seg.durationMs;
      existing.segmentCount += 1;
      if (segViewerHours != null) existing.viewerHours = (existing.viewerHours ?? 0) + segViewerHours;
    } else {
      aggMap.set(key, {
        game: key,
        airtimeMs: seg.durationMs,
        pctOfVod: 0,
        viewerHours: segViewerHours,
        segmentCount: 1,
        isCasino: isCasinoCategory(seg.game),
        color: categoryColors.get(key)!,
      });
    }
  }

  const aggregates = Array.from(aggMap.values());
  for (const a of aggregates) {
    a.pctOfVod = data.lengthMs > 0 ? (a.airtimeMs / data.lengthMs) * 100 : 0;
    if (a.viewerHours == null && avgViewers != null) {
      a.viewerHours = avgViewers * (a.airtimeMs / 3_600_000);
    }
  }
  aggregates.sort((x, y) => y.airtimeMs - x.airtimeMs);

  const hasViewerData = !!viewerSeries?.length || avgViewers != null;
  const isEstimate = !viewerSeries?.length && avgViewers != null;

  const casinoAgg = aggregates.filter((a) => a.isCasino);
  const casinoAirtimeMs = casinoAgg.reduce((s, a) => s + a.airtimeMs, 0);
  const casinoPct = data.lengthMs > 0 ? (casinoAirtimeMs / data.lengthMs) * 100 : 0;
  const casinoViewerHours = hasViewerData ? casinoAgg.reduce((s, a) => s + (a.viewerHours ?? 0), 0) : null;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex h-9 w-full overflow-hidden rounded-md border">
          {data.segments.map((seg, i) => {
            const widthPct = data.lengthMs > 0 ? (seg.durationMs / data.lengthMs) * 100 : 0;
            const key = seg.game ?? "—";
            return (
              <div
                key={i}
                title={`${key}\n${formatHms(seg.startMs)} – ${formatHms(seg.endMs)} (${formatHms(seg.durationMs)})`}
                style={{ width: `${widthPct}%`, backgroundColor: categoryColors.get(key) }}
                className="h-full border-r border-background/40 last:border-r-0 transition-opacity hover:opacity-80"
              />
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>0:00</span>
          <span>{formatHms(data.lengthMs)}</span>
        </div>
      </div>

      {casinoAirtimeMs > 0 && (
        <div className="rounded-lg border bg-primary/5 p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Total iGaming nesta VOD</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-lg font-semibold tabular-nums">{formatHms(casinoAirtimeMs)}</span>
            <span className="text-sm text-muted-foreground tabular-nums">{casinoPct.toFixed(1)}% da VOD</span>
            {casinoViewerHours != null && (
              <span className="text-sm tabular-nums">
                {formatHours(casinoViewerHours)} viewer-hours{isEstimate ? " (est.)" : ""}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b">
              <th className="py-2 pr-3 font-medium">Categoria</th>
              <th className="py-2 px-3 font-medium text-right">Airtime</th>
              <th className="py-2 px-3 font-medium text-right">% da VOD</th>
              {hasViewerData && (
                <th className="py-2 pl-3 font-medium text-right">
                  Viewer-hours{isEstimate ? " (est.)" : ""}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {aggregates.map((a) => (
              <tr key={a.game} className="border-b last:border-b-0">
                <td className="py-2 pr-3">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: a.color }} />
                    <span className={a.isCasino ? "font-semibold" : ""}>{a.game}</span>
                    {a.isCasino && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                        iGaming
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-2 px-3 text-right tabular-nums">{formatHms(a.airtimeMs)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{a.pctOfVod.toFixed(1)}%</td>
                {hasViewerData && (
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {a.viewerHours != null ? formatHours(a.viewerHours) : "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isEstimate && (
        <p className="text-xs text-muted-foreground">
          Viewer-hours estimado a partir de média única × airtime (assume audiência uniforme entre
          categorias). Para valores precisos, passe uma série temporal em <code className="px-1">viewerSeries</code>.
        </p>
      )}
    </div>
  );
}
