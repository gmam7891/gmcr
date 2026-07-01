import { CAMPAIGN_TYPES, type CampaignType } from "@/lib/instagram/campaignTypes";
import { cn } from "@/lib/utils";

interface Props {
  value: CampaignType;
  onChange: (type: CampaignType) => void;
  /** Optional filter — only these types will be shown. Defaults to all. */
  enabledTypes?: CampaignType[];
}

export function CampaignTypeSelector({ value, onChange, enabledTypes }: Props) {
  const visible = enabledTypes
    ? CAMPAIGN_TYPES.filter((t) => enabledTypes.includes(t.value))
    : CAMPAIGN_TYPES;

  if (visible.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 p-1 bg-secondary/50 rounded-lg border border-border">
      {visible.map((type) => (
        <button
          key={type.value}
          onClick={() => onChange(type.value)}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-md text-xs font-mono uppercase tracking-wider transition-all",
            value === type.value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary"
          )}
        >
          <span>{type.icon}</span>
          <span>{type.label}</span>
        </button>
      ))}
    </div>
  );
}
