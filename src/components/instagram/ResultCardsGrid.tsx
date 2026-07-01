import { MetricCard } from "@/components/MetricCard";
import { fmtMoney, fmtInt, fmtPercent } from "@/lib/formatters";
import type { ResultCardDef } from "@/lib/instagram/campaignTypes";

interface Props {
  cards: ResultCardDef[];
  results: Record<string, number>;
  fee: number;
  inputs?: Record<string, number>;
}

function formatValue(value: number, format: ResultCardDef["format"]): string {
  if (value == null || isNaN(value)) return "-";
  switch (format) {
    case "currency": return fmtMoney(value);
    case "percent": return fmtPercent(value, 1);
    case "integer": return fmtInt(Math.round(value));
    case "decimal": return value.toFixed(2).replace(".", ",") + "x";
    case "months": return `${value.toFixed(1).replace(".", ",")} meses`;
    default: return String(value);
  }
}

function getStatus(key: string, value: number, fee: number): "go" | "warning" | "nogo" | undefined {
  if (key.includes("Roi") || key === "estimatedRoi" || key === "retentionRoi") {
    if (fee <= 0) return undefined;
    if (value >= 200) return "go";
    if (value >= 0) return "warning";
    return "nogo";
  }
  if (key === "estimatedRoas") {
    if (value >= 3) return "go";
    if (value >= 1) return "warning";
    if (value > 0) return "nogo";
    return undefined;
  }
  if (key === "considerationScore") {
    if (value >= 70) return "go";
    if (value >= 40) return "warning";
    return "nogo";
  }
  return undefined;
}

export function ResultCardsGrid({ cards, results, fee, inputs }: Props) {
  const visible = cards.filter((c) => !c.showIf || c.showIf(results, inputs ?? {}));
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {visible.map((card) => {
        const value = results[card.key] ?? 0;
        return (
          <MetricCard
            key={card.key}
            label={card.label}
            value={formatValue(value, card.format)}
            status={getStatus(card.key, value, fee)}
            className={card.highlight ? "ring-1 ring-primary/20" : ""}
          />
        );
      })}
    </div>
  );
}
