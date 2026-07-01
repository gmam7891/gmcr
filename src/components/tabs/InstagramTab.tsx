import { useState, useMemo, useCallback, useEffect } from "react";
import { CampaignTypeSelector } from "@/components/instagram/CampaignTypeSelector";
import { StageMultiSelect } from "@/components/instagram/StageMultiSelect";
import { BaseInfluencerFields } from "@/components/instagram/BaseInfluencerFields";
import { DynamicCampaignFields } from "@/components/instagram/DynamicCampaignFields";
import { ResultCardsGrid } from "@/components/instagram/ResultCardsGrid";
import { InsightCards } from "@/components/instagram/InsightCards";
import { calculateCampaign } from "@/lib/instagram/campaignCalculators";
import { getCampaignConfigs } from "@/lib/instagram/campaignFieldConfig";
import { CAMPAIGN_TYPES, type CampaignType } from "@/lib/instagram/campaignTypes";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import * as XLSX from "xlsx";

const ALL_TYPES = CAMPAIGN_TYPES.map((t) => t.value);
const STAGES_STORAGE_KEY = "campaign-stages:Instagram";

const BASE_KEYS = [
  "followers", "avgReach", "influencerFee", "engagementRate",
  "reelsDeliveries", "reelsViews", "reelsEngagement",
  "storiesDeliveries", "storiesViews", "storiesEngagement",
];

export function InstagramTab() {
  const { t } = useLanguage();

  const [enabledStages, setEnabledStages] = useState<CampaignType[]>(() => {
    if (typeof window === "undefined") return ALL_TYPES;
    try {
      const raw = localStorage.getItem(STAGES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CampaignType[];
        if (Array.isArray(parsed)) return parsed.filter((s) => ALL_TYPES.includes(s));
      }
    } catch {}
    return ALL_TYPES;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STAGES_STORAGE_KEY, JSON.stringify(enabledStages));
    } catch {}
  }, [enabledStages]);

  const [campaignType, setCampaignType] = useState<CampaignType>(
    enabledStages[0] ?? "igaming",
  );

  useEffect(() => {
    if (enabledStages.length > 0 && !enabledStages.includes(campaignType)) {
      setCampaignType(enabledStages[0]);
    }
  }, [enabledStages, campaignType]);

  const [username, setUsername] = useState("");
  const [values, setValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    BASE_KEYS.forEach((k) => (init[k] = 0));
    return init;
  });

  const handleChange = useCallback((key: string, value: number) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const campaignConfigs = getCampaignConfigs(t);
  const config = campaignConfigs[campaignType];

  const allInputs = useMemo(() => {
    const merged: Record<string, number> = { ...values };
    config.fields.forEach((f) => {
      if (merged[f.key] == null) merged[f.key] = f.defaultValue ?? 0;
    });
    return merged;
  }, [values, config]);

  const results = useMemo(() => calculateCampaign(campaignType, allInputs), [campaignType, allInputs]);

  const downloadExcel = () => {
    const rows: (string | number)[][] = [
      ["Campaign type", config.label],
      [""],
      ["Field", "Value"],
      ["Followers", values.followers ?? 0],
      ["Avg reach", values.avgReach ?? 0],
      ["Fee", values.influencerFee ?? 0],
      ["Reels · Qty", values.reelsDeliveries ?? 0],
      ["Reels · Avg views", values.reelsViews ?? 0],
      ["Reels · Engagement (%)", values.reelsEngagement ?? 0],
      ["Stories · Qty", values.storiesDeliveries ?? 0],
      ["Stories · Avg views", values.storiesViews ?? 0],
      ["Stories · Engagement (%)", values.storiesEngagement ?? 0],
      ...config.fields.map((f) => [f.label, values[f.key] ?? f.defaultValue ?? 0]),
      [""],
      ["Result", "Value"],
      ...config.resultCards.map((c) => [c.label, results[c.key] ?? 0]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 35 }, { wch: 22 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Instagram Campaign");
    XLSX.writeFile(wb, `campanha-instagram-${campaignType}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground tracking-tight">{t("ig.title")}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t("ig.subtitle")}</p>
      </div>

      <StageMultiSelect
        value={enabledStages}
        onChange={setEnabledStages}
        label="Quais etapas este pacote usa no Instagram?"
      />

      {enabledStages.length === 0 ? (
        <div className="card-surface p-6 text-sm text-muted-foreground text-center">
          Selecione ao menos uma etapa acima para configurar a campanha do Instagram.
        </div>
      ) : (
        <>
          <CampaignTypeSelector
            value={campaignType}
            onChange={setCampaignType}
            enabledTypes={enabledStages}
          />

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <BaseInfluencerFields values={values} onChange={handleChange} username={username} setUsername={setUsername} />
              <DynamicCampaignFields fields={config.fields} values={values} onChange={handleChange} title={`${t("ig.params")} · ${config.label}`} />
            </div>

            <div className="lg:col-span-3 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{t("app.results")}</h3>
                <Button variant="outline" size="sm" onClick={downloadExcel}>{t("app.export_excel")}</Button>
              </div>
              <ResultCardsGrid cards={config.resultCards} results={results} fee={values.influencerFee ?? 0} />
              <InsightCards rules={config.insightRules} results={results} inputs={allInputs} />
              <p className="text-xs text-muted-foreground mt-4">{t("ig.calculations_note")}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
