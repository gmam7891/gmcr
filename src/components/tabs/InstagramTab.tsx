import { useState, useMemo, useCallback } from "react";
import { CampaignTypeSelector } from "@/components/instagram/CampaignTypeSelector";
import { BaseInfluencerFields } from "@/components/instagram/BaseInfluencerFields";
import { DynamicCampaignFields } from "@/components/instagram/DynamicCampaignFields";
import { ResultCardsGrid } from "@/components/instagram/ResultCardsGrid";
import { InsightCards } from "@/components/instagram/InsightCards";
import { calculateCampaign } from "@/lib/instagram/campaignCalculators";
import { campaignConfigs } from "@/lib/instagram/campaignFieldConfig";
import type { CampaignType } from "@/lib/instagram/campaignTypes";
import { Button } from "@/components/ui/button";
import * as XLSX from "xlsx";

const BASE_KEYS = [
  "followers", "avgReach", "influencerFee",
  "reelsDeliveries", "reelsViews", "reelsEngagement",
  "storiesDeliveries", "storiesViews", "storiesEngagement",
];

export function InstagramTab() {
  const [campaignType, setCampaignType] = useState<CampaignType>("igaming");
  const [username, setUsername] = useState("");
  const [values, setValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    BASE_KEYS.forEach((k) => (init[k] = 0));
    return init;
  });

  const handleChange = useCallback((key: string, value: number) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

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
      ["Tipo de campanha", config.label],
      [""],
      ["Campo", "Valor"],
      ...BASE_KEYS.map((k) => [k, values[k] ?? 0]),
      ...config.fields.map((f) => [f.label, values[f.key] ?? f.defaultValue ?? 0]),
      [""],
      ["Resultado", "Valor"],
      ...config.resultCards.map((c) => [c.label, results[c.key] ?? 0]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 35 }, { wch: 22 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Campanha Instagram");
    XLSX.writeFile(wb, `campanha-instagram-${campaignType}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-foreground tracking-tight">Instagram Campaign Calculator</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Simule campanhas por objetivo e avalie eficiência, custo e retorno esperado
        </p>
      </div>

      {/* Campaign Type Selector */}
      <CampaignTypeSelector value={campaignType} onChange={setCampaignType} />

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Inputs Column */}
        <div className="lg:col-span-2 space-y-6">
          <BaseInfluencerFields
            values={values}
            onChange={handleChange}
            username={username}
            setUsername={setUsername}
          />
          <DynamicCampaignFields
            fields={config.fields}
            values={values}
            onChange={handleChange}
            title={`Parâmetros · ${config.label}`}
          />
        </div>

        {/* Results Column */}
        <div className="lg:col-span-3 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Resultados</h3>
            <Button variant="outline" size="sm" onClick={downloadExcel}>
              📥 Exportar Excel
            </Button>
          </div>

          <ResultCardsGrid cards={config.resultCards} results={results} fee={values.influencerFee ?? 0} />

          <InsightCards rules={config.insightRules} results={results} inputs={allInputs} />

          <p className="text-xs text-muted-foreground mt-4">
            Os cálculos são baseados nas estimativas informadas. Audiência base utiliza alcance médio quando disponível, caso contrário views médias.
          </p>
        </div>
      </div>
    </div>
  );
}
