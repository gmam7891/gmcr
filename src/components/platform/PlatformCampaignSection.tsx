import { useState, useMemo, useCallback, useEffect } from "react";
import { CampaignTypeSelector } from "@/components/instagram/CampaignTypeSelector";
import { StageMultiSelect } from "@/components/instagram/StageMultiSelect";
import { DynamicCampaignFields } from "@/components/instagram/DynamicCampaignFields";
import { ResultCardsGrid } from "@/components/instagram/ResultCardsGrid";
import { InsightCards } from "@/components/instagram/InsightCards";
import { calculateCampaign } from "@/lib/instagram/campaignCalculators";
import { getCampaignConfigs } from "@/lib/instagram/campaignFieldConfig";
import { CAMPAIGN_TYPES, type CampaignType } from "@/lib/instagram/campaignTypes";
import { useLanguage } from "@/contexts/LanguageContext";

interface Props {
  platformReach: number;
  fee: number;
  platformLabel?: string;
}

const ALL_TYPES = CAMPAIGN_TYPES.map((t) => t.value);

export function PlatformCampaignSection({ platformReach, fee, platformLabel }: Props) {
  const { t } = useLanguage();
  const storageKey = `campaign-stages:${platformLabel ?? "default"}`;

  const [enabledStages, setEnabledStages] = useState<CampaignType[]>(() => {
    if (typeof window === "undefined") return ALL_TYPES;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as CampaignType[];
        if (Array.isArray(parsed)) return parsed.filter((s) => ALL_TYPES.includes(s));
      }
    } catch {}
    return ALL_TYPES;
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(enabledStages));
    } catch {}
  }, [storageKey, enabledStages]);

  const [campaignType, setCampaignType] = useState<CampaignType>(
    enabledStages[0] ?? "igaming",
  );

  // If the active stage becomes disabled, fall back to the first enabled one.
  useEffect(() => {
    if (enabledStages.length > 0 && !enabledStages.includes(campaignType)) {
      setCampaignType(enabledStages[0]);
    }
  }, [enabledStages, campaignType]);

  // Values are kept per-stage so unchecking + rechecking preserves data.
  const [valuesByStage, setValuesByStage] = useState<
    Record<string, Record<string, number>>
  >({});

  const values = valuesByStage[campaignType] ?? {};

  const handleChange = useCallback(
    (key: string, value: number) => {
      setValuesByStage((prev) => ({
        ...prev,
        [campaignType]: { ...(prev[campaignType] ?? {}), [key]: value },
      }));
    },
    [campaignType],
  );

  const campaignConfigs = getCampaignConfigs(t);
  const config = campaignConfigs[campaignType];

  const allInputs = useMemo(() => {
    const merged: Record<string, number> = { ...values };
    merged.avgReach = platformReach;
    merged.reelsDeliveries = 1;
    merged.storiesDeliveries = 0;
    merged.reelsViews = 0;
    merged.storiesViews = 0;
    merged.influencerFee = fee;
    config.fields.forEach((f) => {
      if (merged[f.key] == null) merged[f.key] = f.defaultValue ?? 0;
    });
    return merged;
  }, [values, config, platformReach, fee]);

  const results = useMemo(
    () => calculateCampaign(campaignType, allInputs),
    [campaignType, allInputs],
  );

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          {platformLabel ? `${platformLabel} Campaign Calculator` : t("ig.title")}
        </h3>

        <StageMultiSelect
          value={enabledStages}
          onChange={setEnabledStages}
          label={
            platformLabel
              ? `Quais etapas este pacote usa no ${platformLabel}?`
              : "Quais etapas este pacote usa?"
          }
        />

        {enabledStages.length > 0 ? (
          <CampaignTypeSelector
            value={campaignType}
            onChange={setCampaignType}
            enabledTypes={enabledStages}
          />
        ) : (
          <div className="card-surface p-4 text-sm text-muted-foreground">
            Selecione ao menos uma etapa acima para configurar a campanha.
          </div>
        )}
      </div>

      {enabledStages.length > 0 && (
        <>
          <DynamicCampaignFields
            fields={config.fields}
            values={values}
            onChange={handleChange}
            title={`${t("ig.params")} · ${config.label}`}
          />

          <ResultCardsGrid cards={config.resultCards} results={results} fee={fee} />
          <InsightCards rules={config.insightRules} results={results} inputs={allInputs} />
        </>
      )}
    </div>
  );
}
