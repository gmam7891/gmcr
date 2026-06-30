import { useState, useMemo, useCallback } from "react";
import { CampaignTypeSelector } from "@/components/instagram/CampaignTypeSelector";
import { DynamicCampaignFields } from "@/components/instagram/DynamicCampaignFields";
import { ResultCardsGrid } from "@/components/instagram/ResultCardsGrid";
import { InsightCards } from "@/components/instagram/InsightCards";
import { calculateCampaign } from "@/lib/instagram/campaignCalculators";
import { getCampaignConfigs } from "@/lib/instagram/campaignFieldConfig";
import type { CampaignType } from "@/lib/instagram/campaignTypes";
import { useLanguage } from "@/contexts/LanguageContext";

interface Props {
  /** Total reach provided by the platform (unique viewers, total views, etc.) */
  platformReach: number;
  /** Fee already set in the platform section */
  fee: number;
  /** Platform name shown in the section title (e.g. "Twitch", "YouTube", "Kick") */
  platformLabel?: string;
}

/**
 * Reusable campaign calculator section for streaming platforms (Twitch, YouTube, Kick, TikTok).
 * Takes the platform's base reach and fee, then applies campaign-type-specific calculations.
 */
export function PlatformCampaignSection({ platformReach, fee, platformLabel }: Props) {
  const { t } = useLanguage();
  const [campaignType, setCampaignType] = useState<CampaignType>("igaming");
  const [values, setValues] = useState<Record<string, number>>({});

  const handleChange = useCallback((key: string, value: number) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const campaignConfigs = getCampaignConfigs(t);
  const config = campaignConfigs[campaignType];

  const allInputs = useMemo(() => {
    const merged: Record<string, number> = { ...values };
    // Inject platform reach as avgReach so the calculators pick it up
    merged.avgReach = platformReach;
    // Set deliveries to 1 so getBase() returns avgReach * 1
    merged.reelsDeliveries = 1;
    merged.storiesDeliveries = 0;
    merged.reelsViews = 0;
    merged.storiesViews = 0;
    // Inject fee
    merged.influencerFee = fee;
    // Apply defaults for campaign-specific fields
    config.fields.forEach((f) => {
      if (merged[f.key] == null) merged[f.key] = f.defaultValue ?? 0;
    });
    return merged;
  }, [values, config, platformReach, fee]);

  const results = useMemo(
    () => calculateCampaign(campaignType, allInputs),
    [campaignType, allInputs]
  );

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          {platformLabel ? `${platformLabel} Campaign Calculator` : t("ig.title")}
        </h3>
        <CampaignTypeSelector value={campaignType} onChange={setCampaignType} />
      </div>

      <DynamicCampaignFields
        fields={config.fields}
        values={values}
        onChange={handleChange}
        title={`${t("ig.params")} · ${config.label}`}
      />

      <ResultCardsGrid cards={config.resultCards} results={results} fee={fee} />
      <InsightCards rules={config.insightRules} results={results} inputs={allInputs} />
    </div>
  );
}
