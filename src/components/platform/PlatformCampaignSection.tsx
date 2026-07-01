import { useState, useMemo, useCallback, useEffect } from "react";
import { CampaignTypeSelector } from "@/components/instagram/CampaignTypeSelector";
import { DynamicCampaignFields } from "@/components/instagram/DynamicCampaignFields";
import { ResultCardsGrid } from "@/components/instagram/ResultCardsGrid";
import { InsightCards } from "@/components/instagram/InsightCards";
import { calculateCampaign } from "@/lib/instagram/campaignCalculators";
import { getCampaignConfigs } from "@/lib/instagram/campaignFieldConfig";
import { type CampaignType } from "@/lib/instagram/campaignTypes";
import { resolveEnabledStages } from "@/lib/campaign/stageEntitlements";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { fmtInt } from "@/lib/formatters";

interface Props {
  /** Base audience number pulled from the platform's own API (views / reach / impressions). */
  platformReach: number;
  /** Human label for the platform (Twitch, YouTube, Kick, TikTok, Instagram). */
  platformLabel: string;
}

export function PlatformCampaignSection({ platformReach, platformLabel }: Props) {
  const { t } = useLanguage();
  const { userAccess } = useAuth();
  const valuesKey = `campaign-values:${platformLabel}`;

  // Which stages this client contracted for this platform — configured by the
  // admin, enforced here (no longer a self-service toggle).
  const enabledStages = useMemo(
    () => resolveEnabledStages(userAccess?.allowed_stages, platformLabel),
    [userAccess?.allowed_stages, platformLabel],
  );

  const [campaignType, setCampaignType] = useState<CampaignType>(enabledStages[0] ?? "igaming");

  useEffect(() => {
    if (enabledStages.length > 0 && !enabledStages.includes(campaignType)) {
      setCampaignType(enabledStages[0]);
    }
  }, [enabledStages, campaignType]);

  // Values persisted per stage
  const [valuesByStage, setValuesByStage] = useState<Record<string, Record<string, number>>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem(valuesKey);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  });

  useEffect(() => {
    try {
      localStorage.setItem(valuesKey, JSON.stringify(valuesByStage));
    } catch {}
  }, [valuesKey, valuesByStage]);

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
    config.fields.forEach((f) => {
      if (merged[f.key] == null) merged[f.key] = f.defaultValue ?? 0;
    });
    return merged;
  }, [values, config, platformReach]);

  const results = useMemo(() => calculateCampaign(campaignType, allInputs), [campaignType, allInputs]);
  const stageFee = values.influencerFee ?? 0;

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            {platformLabel} · Calculadora de campanha
          </h3>
          <span className="text-[11px] text-muted-foreground font-mono">
            Base de público: {fmtInt(platformReach)} (via API {platformLabel})
          </span>
        </div>

        {enabledStages.length > 0 ? (
          <CampaignTypeSelector
            value={campaignType}
            onChange={setCampaignType}
            enabledTypes={enabledStages}
          />
        ) : (
          <div className="card-surface p-4 text-sm text-muted-foreground">
            Nenhuma etapa liberada para {platformLabel} neste pacote. Fale com o administrador.
          </div>
        )}
      </div>

      {enabledStages.length > 0 && (
        <>
          <DynamicCampaignFields
            fields={config.fields}
            values={values}
            onChange={handleChange}
            title={`Parâmetros · ${config.label}`}
          />
          <ResultCardsGrid cards={config.resultCards} results={results} fee={stageFee} inputs={allInputs} />
          <InsightCards rules={config.insightRules} results={results} inputs={allInputs} />
        </>
      )}
    </div>
  );
}
