import { CAMPAIGN_TYPES, type CampaignType } from "@/lib/instagram/campaignTypes";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface Props {
  value: CampaignType[];
  onChange: (types: CampaignType[]) => void;
  label?: string;
  className?: string;
}

/**
 * Multi-select for enabling/disabling campaign stages per platform.
 * Renders as a compact row of checkboxes.
 */
export function StageMultiSelect({ value, onChange, label, className }: Props) {
  const toggle = (type: CampaignType) => {
    if (value.includes(type)) {
      onChange(value.filter((t) => t !== type));
    } else {
      // preserve canonical order
      const next = CAMPAIGN_TYPES.map((t) => t.value).filter(
        (t) => value.includes(t) || t === type,
      );
      onChange(next);
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {CAMPAIGN_TYPES.map((type) => {
          const checked = value.includes(type.value);
          return (
            <label
              key={type.value}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md border cursor-pointer transition-colors text-xs font-mono uppercase tracking-wider",
                checked
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground",
              )}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggle(type.value)}
                className="h-3.5 w-3.5"
              />
              <span>{type.icon}</span>
              <span>{type.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
