import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export function MetricCardSkeleton() {
  return (
    <Card className="p-2.5">
      <Skeleton className="h-3 w-16 mb-1.5" />
      <Skeleton className="h-5 w-20" />
    </Card>
  );
}

export function MetricGridSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
      {Array.from({ length: count }).map((_, i) => <MetricCardSkeleton key={i} />)}
    </div>
  );
}

export function ChartSkeleton({ height = 220, title = true }: { height?: number; title?: boolean }) {
  return (
    <Card className="p-3">
      {title && (
        <div className="mb-2">
          <Skeleton className="h-3 w-40 mb-1" />
          <Skeleton className="h-2 w-56" />
        </div>
      )}
      <Skeleton className="w-full" style={{ height }} />
    </Card>
  );
}

export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <Card className="p-3">
      <div className="space-y-1.5">
        <div className="flex gap-3 pb-2 border-b border-border">
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-3 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-3 py-1.5">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className="h-3 flex-1" style={{ opacity: 1 - r * 0.06 }} />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-3">
      <Card className="p-3">
        <Skeleton className="h-3 w-24 mb-1.5" />
        <Skeleton className="h-4 w-3/4" />
      </Card>
      <MetricGridSkeleton count={5} />
      <ChartSkeleton height={220} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ChartSkeleton height={200} />
        <ChartSkeleton height={200} />
      </div>
    </div>
  );
}
