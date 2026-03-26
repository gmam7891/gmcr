import { cn } from "@/lib/utils";
import type { InsightRule, InsightLevel } from "@/lib/instagram/campaignTypes";

interface Props {
  rules: InsightRule[];
  results: Record<string, number>;
  inputs: Record<string, number>;
}

const levelConfig: Record<InsightLevel, { icon: string; bgClass: string; textClass: string; borderClass: string }> = {
  positive: {
    icon: "✅",
    bgClass: "bg-accent/10",
    textClass: "text-accent",
    borderClass: "border-accent/20",
  },
  neutral: {
    icon: "ℹ️",
    bgClass: "bg-primary/10",
    textClass: "text-primary",
    borderClass: "border-primary/20",
  },
  warning: {
    icon: "⚠️",
    bgClass: "bg-warning/10",
    textClass: "text-warning",
    borderClass: "border-warning/20",
  },
};

export function InsightCards({ rules, results, inputs }: Props) {
  const activeInsights = rules
    .filter((rule) => {
      try { return rule.condition(results, inputs); } catch { return false; }
    })
    .slice(0, 4);

  if (activeInsights.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Insights</h3>
      <div className="grid gap-2">
        {activeInsights.map((insight, i) => {
          const config = levelConfig[insight.level];
          return (
            <div
              key={i}
              className={cn(
                "flex items-start gap-3 p-3 rounded-lg border",
                config.bgClass,
                config.borderClass
              )}
            >
              <span className="text-base shrink-0 mt-0.5">{config.icon}</span>
              <div className="min-w-0">
                <p className={cn("text-sm font-medium", config.textClass)}>{insight.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{insight.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
