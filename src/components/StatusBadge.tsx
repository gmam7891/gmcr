import { cn } from "@/lib/utils";

type StatusType = "go" | "warning" | "nogo";

interface StatusBadgeProps {
  status: StatusType;
  className?: string;
}

const config: Record<StatusType, { label: string; className: string }> = {
  go: { label: "✅ LUCRATIVO", className: "bg-accent/10 text-accent border-accent/20" },
  warning: { label: "⚠️ MARGEM POSITIVA", className: "bg-warning/10 text-warning border-warning/20" },
  nogo: { label: "❌ PREJUÍZO", className: "bg-destructive/10 text-destructive border-destructive/20" },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const c = config[status];
  return (
    <div className={cn("inline-flex items-center px-4 py-2 rounded-lg border text-sm font-medium", c.className, className)}>
      {c.label}
    </div>
  );
}
