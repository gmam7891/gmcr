import type { CampaignConfig } from "./campaignTypes";

type TFunc = (key: string) => string;

/**
 * Field configuration per funnel stage.
 * IMPORTANT: every stage always includes `icpPercent` and `influencerFee`.
 * FTD-related fields ONLY appear in `igaming`.
 * `productValue` in conversion/retention is OPTIONAL — if blank, revenue cards
 * are hidden via `showIf` and only volume/cost metrics are shown.
 */
export function getCampaignConfigs(_t: TFunc): Record<string, CampaignConfig> {
  const commonFields = [
    { key: "icpPercent", label: "% ICP", type: "percent" as const, step: 0.5, defaultValue: 0 },
    { key: "influencerFee", label: "Fee / Investimento", type: "currency" as const, step: 500, defaultValue: 0 },
  ];

  return {
    igaming: {
      label: "iGaming",
      fields: [
        ...commonFields,
        { key: "estimatedCtr", label: "CTR", type: "percent", step: 0.1, defaultValue: 0 },
        { key: "ftdRate", label: "CVR para FTD", type: "percent", step: 0.1, defaultValue: 0 },
        { key: "valuePerFtd", label: "Valor por FTD", type: "currency", step: 50, defaultValue: 0 },
      ],
      resultCards: [
        { key: "estimatedImpressions", label: "Impressões estimadas", format: "integer" },
        { key: "estimatedClicks", label: "Cliques estimados", format: "integer" },
        { key: "estimatedFtds", label: "FTDs estimados", format: "integer", highlight: true },
        { key: "estimatedRevenue", label: "Receita estimada", format: "currency", highlight: true },
        { key: "estimatedCpa", label: "CPA (FTD)", format: "currency", highlight: true },
        { key: "estimatedRoas", label: "ROAS", format: "decimal", highlight: true },
      ],
      insightRules: [
        {
          condition: (r) => r.estimatedRoas >= 3,
          level: "positive",
          title: "ROAS forte",
          description: "Cada real investido retorna mais de 3× em receita projetada de FTD.",
        },
        {
          condition: (r, i) => i.influencerFee > 0 && r.estimatedRoas > 0 && r.estimatedRoas < 1,
          level: "warning",
          title: "ROAS abaixo de 1",
          description: "A receita projetada não cobre o fee. Revise ICP, CTR ou CVR.",
        },
      ],
    },

    awareness: {
      label: "Awareness",
      fields: [
        ...commonFields,
        { key: "averageFrequency", label: "Frequência média estimada", type: "number", step: 0.1, defaultValue: 1 },
        { key: "benchmarkCpm", label: "CPM de referência", type: "currency", step: 1, defaultValue: 0, hint: "Usado apenas como comparação" },
        { key: "qualifiedReachRate", label: "Taxa de alcance qualificado", type: "percent", step: 0.5, defaultValue: 0 },
      ],
      resultCards: [
        { key: "estimatedImpressions", label: "Impressões estimadas", format: "integer" },
        { key: "estimatedUniqueReach", label: "Alcance único", format: "integer", highlight: true },
        { key: "qualifiedReach", label: "Alcance qualificado", format: "integer", highlight: true },
        { key: "effectiveCpm", label: "CPM efetivo", format: "currency", highlight: true },
      ],
      insightRules: [
        {
          condition: (r, i) => i.benchmarkCpm > 0 && r.effectiveCpm > 0 && r.effectiveCpm < i.benchmarkCpm,
          level: "positive",
          title: "CPM abaixo do benchmark",
          description: "O CPM efetivo está mais barato que o mercado de referência.",
        },
        {
          condition: (r, i) => i.benchmarkCpm > 0 && r.effectiveCpm > i.benchmarkCpm * 1.5,
          level: "warning",
          title: "CPM acima do mercado",
          description: "Custo por mil impressões 50%+ acima do benchmark informado.",
        },
      ],
    },

    consideration: {
      label: "Consideração",
      fields: [
        ...commonFields,
        { key: "qualifiedEngagementRate", label: "Taxa de engajamento", type: "percent", step: 0.1, defaultValue: 0 },
        { key: "estimatedCtr", label: "CTR para consideração", type: "percent", step: 0.1, defaultValue: 0 },
        { key: "benchmarkCpe", label: "CPE / CPM de referência", type: "currency", step: 0.5, defaultValue: 0, hint: "Usado apenas como comparação" },
      ],
      resultCards: [
        { key: "engagedUsers", label: "Engajamentos estimados", format: "integer", highlight: true },
        { key: "estimatedClicks", label: "Cliques / visitas estimadas", format: "integer" },
        { key: "considerationReach", label: "Público em consideração", format: "integer", highlight: true },
        { key: "estimatedCpe", label: "CPE (custo por engajamento)", format: "currency", highlight: true },
      ],
      insightRules: [
        {
          condition: (r, i) => i.benchmarkCpe > 0 && r.estimatedCpe > 0 && r.estimatedCpe < i.benchmarkCpe,
          level: "positive",
          title: "CPE competitivo",
          description: "Custo por engajamento abaixo do benchmark informado.",
        },
      ],
    },

    conversion: {
      label: "Conversão",
      fields: [
        ...commonFields,
        { key: "estimatedCtr", label: "CTR", type: "percent", step: 0.1, defaultValue: 0 },
        { key: "finalConversionRate", label: "CVR para conversão", type: "percent", step: 0.1, defaultValue: 0 },
        {
          key: "productValue",
          label: "Valor médio do produto/serviço",
          type: "currency",
          step: 50,
          defaultValue: 0,
          optional: true,
          hint: "Opcional — se preencher, calculamos receita e ROAS",
        },
      ],
      resultCards: [
        { key: "estimatedClicks", label: "Cliques estimados", format: "integer" },
        { key: "estimatedConversions", label: "Conversões estimadas", format: "integer", highlight: true },
        { key: "costPerConversion", label: "CPA (custo por conversão)", format: "currency", highlight: true },
        {
          key: "estimatedRevenue",
          label: "Receita estimada",
          format: "currency",
          highlight: true,
          showIf: (_r, i) => (i.productValue ?? 0) > 0,
        },
        {
          key: "estimatedRoas",
          label: "ROAS",
          format: "decimal",
          highlight: true,
          showIf: (_r, i) => (i.productValue ?? 0) > 0,
        },
      ],
      insightRules: [
        {
          condition: (r, i) => (i.productValue ?? 0) > 0 && r.estimatedRoas >= 3,
          level: "positive",
          title: "ROAS forte",
          description: "Retorno superior a 3× o investimento.",
        },
        {
          condition: (r, i) => r.estimatedConversions > 0 && (i.productValue ?? 0) > 0 && r.costPerConversion > i.productValue,
          level: "warning",
          title: "CPA acima do valor do produto",
          description: "O custo por conversão está mais alto do que o próprio valor do produto/serviço.",
        },
      ],
    },

    retention: {
      label: "Retenção",
      fields: [
        ...commonFields,
        { key: "repurchaseRate", label: "Taxa de retenção estimada", type: "percent", step: 1, defaultValue: 0 },
        { key: "repurchaseFrequency", label: "Frequência de recompra / re-engajamento", type: "number", step: 0.1, defaultValue: 1 },
        {
          key: "productValue",
          label: "Valor médio do produto/serviço",
          type: "currency",
          step: 50,
          defaultValue: 0,
          optional: true,
          hint: "Opcional — se preencher, calculamos LTV e receita recorrente",
        },
      ],
      resultCards: [
        { key: "retainedUsers", label: "Usuários retidos estimados", format: "integer", highlight: true },
        { key: "estimatedRepurchases", label: "Recompras / re-engajamentos", format: "integer" },
        { key: "costPerRetainedUser", label: "Custo por retenção", format: "currency", highlight: true },
        {
          key: "estimatedLtv",
          label: "LTV estimado",
          format: "currency",
          highlight: true,
          showIf: (_r, i) => (i.productValue ?? 0) > 0,
        },
        {
          key: "estimatedRecurringRevenue",
          label: "Receita recorrente",
          format: "currency",
          highlight: true,
          showIf: (_r, i) => (i.productValue ?? 0) > 0,
        },
      ],
      insightRules: [
        {
          condition: (r, i) => (i.productValue ?? 0) > 0 && r.estimatedLtv > r.costPerRetainedUser && r.costPerRetainedUser > 0,
          level: "positive",
          title: "LTV cobre o custo",
          description: "O valor de vida do usuário retido supera o custo para retê-lo.",
        },
      ],
    },
  };
}
