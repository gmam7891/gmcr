import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string;
  delta?: string;
  status?: "go" | "warning" | "nogo" | "neutral";
  className?: string;
}

export function MetricCard({ label, value, delta, status, className }: MetricCardProps) {
  return (
    <div className={cn("card-surface p-4 space-y-1", className)}>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        "metric-value text-2xl",
        status === "go" && "status-go",
        status === "nogo" && "status-nogo",
        status === "warning" && "status-warning",
        !status && "text-foreground"
      )}>
        {value}
      </p>
      {delta && (
        <p className={cn(
          "text-xs font-mono",
          status === "go" && "status-go",
          status === "nogo" && "status-nogo",
          status === "warning" && "status-warning",
          !status && "text-muted-foreground"
        )}>
          {delta}
        </p>
      )}
    </div>
  );
}
