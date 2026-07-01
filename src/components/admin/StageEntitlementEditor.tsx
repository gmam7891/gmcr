import { CAMPAIGN_TYPES, type CampaignType } from "@/lib/instagram/campaignTypes";
import {
  STAGE_PLATFORMS,
  ALL_STAGE_VALUES,
  type AllowedStages,
} from "@/lib/campaign/stageEntitlements";
import { Checkbox } from "@/components/ui/checkbox";

interface Props {
  value: AllowedStages;
  onChange: (next: AllowedStages) => void;
  label?: string;
}

/**
 * Admin control for gating campaign stages (etapas) per platform, per client
 * contract. Replaces the old self-service selector that lived on each platform
 * page — stages are now defined here and clients only see what they contracted.
 */
export function StageEntitlementEditor({ value, onChange, label }: Props) {
  const stagesFor = (key: string): CampaignType[] =>
    Array.isArray(value[key]) ? value[key]! : ALL_STAGE_VALUES;

  const toggle = (key: string, stage: CampaignType) => {
    const current = stagesFor(key);
    const next = current.includes(stage)
      ? current.filter((s) => s !== stage)
      : ALL_STAGE_VALUES.filter((s) => current.includes(s) || s === stage);
    onChange({ ...value, [key]: next });
  };

  const toggleAll = (key: string, enable: boolean) => {
    onChange({ ...value, [key]: enable ? [...ALL_STAGE_VALUES] : [] });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">
        {label ?? "Etapas de campanha liberadas por plataforma"}
      </p>
      <div className="space-y-2">
        {STAGE_PLATFORMS.map((platform) => {
          const current = stagesFor(platform.key);
          const allOn = current.length === ALL_STAGE_VALUES.length;
          return (
            <div
              key={platform.key}
              className="rounded-lg border border-border bg-secondary/30 px-3 py-2"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-foreground">{platform.label}</span>
                <button
                  type="button"
                  className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => toggleAll(platform.key, !allOn)}
                >
                  {allOn ? "Limpar" : "Todas"}
                </button>
              </div>
              <div className="flex flex-wrap gap-3">
                {CAMPAIGN_TYPES.map((type) => (
                  <label
                    key={type.value}
                    className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer"
                  >
                    <Checkbox
                      checked={current.includes(type.value)}
                      onCheckedChange={() => toggle(platform.key, type.value)}
                    />
                    <span>{type.icon}</span>
                    {type.label}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
