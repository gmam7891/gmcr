import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

type StatusType = "go" | "warning" | "nogo";

interface StatusBadgeProps {
  status: StatusType;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { t } = useLanguage();
  const config: Record<StatusType, { labelKey: "status.profitable" | "status.positive_margin" | "status.loss"; className: string }> = {
    go: { labelKey: "status.profitable", className: "bg-accent/10 text-accent border-accent/20" },
    warning: { labelKey: "status.positive_margin", className: "bg-warning/10 text-warning border-warning/20" },
    nogo: { labelKey: "status.loss", className: "bg-destructive/10 text-destructive border-destructive/20" },
  };
  const c = config[status];
  return (
    <div className={cn("inline-flex items-center px-4 py-2 rounded-lg border text-sm font-medium", c.className, className)}>
      {t(c.labelKey)}
    </div>
  );
}
