export type CampaignType = "igaming" | "awareness" | "consideration" | "conversion" | "retention";

export interface CampaignTypeOption {
  value: CampaignType;
  label: string;
  icon: string;
  description: string;
}

export const CAMPAIGN_TYPES: CampaignTypeOption[] = [
  { value: "igaming", label: "iGaming", icon: "🎰", description: "Aquisição e FTD" },
  { value: "awareness", label: "Awareness", icon: "📢", description: "Alcance e exposição" },
  { value: "consideration", label: "Consideração", icon: "🧠", description: "Interesse e tráfego" },
  { value: "conversion", label: "Conversão", icon: "🎯", description: "Vendas e leads" },
  { value: "retention", label: "Retenção", icon: "🔄", description: "Recompra e LTV" },
];

export interface FieldDef {
  key: string;
  label: string;
  type: "number" | "percent" | "currency" | "text";
  step?: number;
  defaultValue?: number;
  group?: string;
  /** Optional helper text below the label */
  hint?: string;
  /** Optional flag — field can be left blank without failing the calc */
  optional?: boolean;
}

export interface ResultCardDef {
  key: string;
  label: string;
  format: "integer" | "currency" | "percent" | "decimal" | "months";
  highlight?: boolean;
  /** Only render this card when the predicate returns true */
  showIf?: (results: Record<string, number>, inputs: Record<string, number>) => boolean;
}

export type InsightLevel = "positive" | "neutral" | "warning";

export interface InsightRule {
  condition: (results: Record<string, number>, inputs: Record<string, number>) => boolean;
  level: InsightLevel;
  title: string;
  description: string;
}

export interface CampaignConfig {
  label: string;
  fields: FieldDef[];
  resultCards: ResultCardDef[];
  insightRules: InsightRule[];
}
