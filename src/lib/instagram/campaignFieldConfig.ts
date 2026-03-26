import type { CampaignConfig } from "./campaignTypes";

export const campaignConfigs: Record<string, CampaignConfig> = {
  igaming: {
    label: "iGaming",
    fields: [
      { key: "icpPercent", label: "% ICP", type: "percent", step: 0.1 },
      { key: "estimatedCtr", label: "CTR estimado (%)", type: "percent", step: 0.1 },
      { key: "registrationRate", label: "Taxa de cadastro (%)", type: "percent", step: 0.1 },
      { key: "ftdRate", label: "Taxa de depósito / FTD (%)", type: "percent", step: 0.1 },
      { key: "valuePerFtd", label: "Valor por FTD (R$)", type: "currency", step: 50 },
      { key: "avgTicket", label: "Ticket médio (R$)", type: "currency", step: 50 },
      { key: "profitMargin", label: "Margem estimada (%)", type: "percent", step: 1 },
    ],
    resultCards: [
      { key: "qualifiedAudience", label: "Audiência qualificada", format: "integer" },
      { key: "estimatedClicks", label: "Cliques estimados", format: "integer" },
      { key: "estimatedRegistrations", label: "Cadastros estimados", format: "integer" },
      { key: "estimatedFtds", label: "FTDs projetados", format: "integer", highlight: true },
      { key: "estimatedRevenue", label: "Receita estimada", format: "currency", highlight: true },
      { key: "estimatedCpa", label: "CPA", format: "currency", highlight: true },
      { key: "estimatedRoi", label: "ROI", format: "percent", highlight: true },
      { key: "recommendedMaxFee", label: "Fee máximo recomendado", format: "currency" },
    ],
    insightRules: [
      {
        condition: (r) => r.estimatedRoi >= 200,
        level: "positive",
        title: "Boa oportunidade de performance",
        description: "ROI projetado acima de 200% indica campanha com alto potencial de retorno.",
      },
      {
        condition: (r) => r.estimatedRoi >= 100 && r.estimatedRoi < 200,
        level: "neutral",
        title: "Campanha viável",
        description: "ROI entre 100% e 200%. Há espaço para otimização de funil.",
      },
      {
        condition: (r) => r.estimatedRoi < 100 && r.estimatedRoi !== 0,
        level: "warning",
        title: "ROI abaixo do ideal",
        description: "Retorno projetado abaixo de 100%. Reavalie fee ou taxas de conversão.",
      },
      {
        condition: (r, i) => i.influencerFee > r.recommendedMaxFee && r.recommendedMaxFee > 0,
        level: "warning",
        title: "Fee acima do recomendado",
        description: "O investimento ultrapassa o fee máximo para manter ROI saudável.",
      },
    ],
  },

  awareness: {
    label: "Awareness",
    fields: [
      { key: "icpPercent", label: "% ICP", type: "percent", step: 0.1 },
      { key: "averageFrequency", label: "Frequência média estimada", type: "number", step: 0.1, defaultValue: 1 },
      { key: "benchmarkCpm", label: "CPM de referência (R$)", type: "currency", step: 1 },
      { key: "qualifiedReachRate", label: "Taxa de alcance qualificado (%)", type: "percent", step: 0.1 },
    ],
    resultCards: [
      { key: "estimatedImpressions", label: "Impressões estimadas", format: "integer" },
      { key: "estimatedUniqueReach", label: "Alcance único", format: "integer", highlight: true },
      { key: "qualifiedReach", label: "Alcance qualificado", format: "integer", highlight: true },
      { key: "realCpm", label: "CPM real", format: "currency", highlight: true },
      { key: "costPerReachedUser", label: "Custo por pessoa alcançada", format: "currency" },
      { key: "qualifiedCpm", label: "CPM qualificado (ICP)", format: "currency", highlight: true },
    ],
    insightRules: [
      {
        condition: (r, i) => r.realCpm < i.benchmarkCpm && i.benchmarkCpm > 0,
        level: "positive",
        title: "Campanha eficiente para topo de funil",
        description: "CPM real abaixo do benchmark de referência.",
      },
      {
        condition: (r, i) => r.qualifiedCpm < i.benchmarkCpm && i.benchmarkCpm > 0,
        level: "positive",
        title: "Baixo custo por alcance qualificado",
        description: "CPM do ICP está abaixo da referência de mercado.",
      },
      {
        condition: (r) => r.averageFrequency < 1.5 && r.averageFrequency > 0,
        level: "warning",
        title: "Frequência pode estar baixa",
        description: "Frequência abaixo de 1.5 pode não gerar reforço de marca suficiente.",
      },
      {
        condition: (r) => r.averageFrequency >= 2 && r.averageFrequency <= 4,
        level: "positive",
        title: "Boa frequência para awareness",
        description: "Frequência entre 2 e 4 é ideal para construção de marca.",
      },
    ],
  },

  consideration: {
    label: "Consideração",
    fields: [
      { key: "icpPercent", label: "% ICP", type: "percent", step: 0.1 },
      { key: "estimatedCtr", label: "CTR estimado (%)", type: "percent", step: 0.1 },
      { key: "contentRetentionRate", label: "Retenção média do conteúdo (%)", type: "percent", step: 1 },
      { key: "qualifiedEngagementRate", label: "Taxa de engajamento qualificado (%)", type: "percent", step: 0.1 },
      { key: "benchmarkCpc", label: "CPC de referência (R$)", type: "currency", step: 0.5 },
    ],
    resultCards: [
      { key: "estimatedClicks", label: "Cliques estimados", format: "integer" },
      { key: "engagedUsers", label: "Usuários engajados", format: "integer", highlight: true },
      { key: "qualifiedTraffic", label: "Tráfego qualificado", format: "integer" },
      { key: "estimatedCpc", label: "CPC estimado", format: "currency", highlight: true },
      { key: "costPerEngagedUser", label: "Custo por engajado", format: "currency" },
      { key: "considerationScore", label: "Score de consideração", format: "integer", highlight: true },
    ],
    insightRules: [
      {
        condition: (r, i) => r.estimatedCpc < i.benchmarkCpc && i.benchmarkCpc > 0,
        level: "positive",
        title: "Custo por clique competitivo",
        description: "CPC estimado abaixo do benchmark de referência.",
      },
      {
        condition: (r) => r.contentRetentionRate >= 35,
        level: "positive",
        title: "Bom potencial de interesse",
        description: "Retenção de conteúdo acima de 35% indica creator relevante para consideração.",
      },
      {
        condition: (r) => r.contentRetentionRate > 0 && r.contentRetentionRate < 20,
        level: "warning",
        title: "Retenção baixa",
        description: "Retenção abaixo de 20% pode comprometer campanha de consideração.",
      },
      {
        condition: (r) => r.considerationScore >= 70,
        level: "positive",
        title: "Boa eficiência de meio de funil",
        description: "Score de consideração acima de 70 indica funil saudável.",
      },
    ],
  },

  conversion: {
    label: "Conversão",
    fields: [
      { key: "icpPercent", label: "% ICP", type: "percent", step: 0.1 },
      { key: "estimatedCtr", label: "CTR estimado (%)", type: "percent", step: 0.1 },
      { key: "finalConversionRate", label: "Taxa de conversão final (%)", type: "percent", step: 0.1 },
      { key: "valuePerConversion", label: "Valor médio por conversão (R$)", type: "currency", step: 50 },
      { key: "conversionMargin", label: "Margem por conversão (%)", type: "percent", step: 1 },
    ],
    resultCards: [
      { key: "estimatedClicks", label: "Cliques estimados", format: "integer" },
      { key: "estimatedConversions", label: "Conversões projetadas", format: "integer", highlight: true },
      { key: "estimatedRevenue", label: "Receita estimada", format: "currency", highlight: true },
      { key: "costPerConversion", label: "Custo por conversão", format: "currency", highlight: true },
      { key: "estimatedRoi", label: "ROI", format: "percent", highlight: true },
      { key: "estimatedRoas", label: "ROAS", format: "decimal", highlight: true },
    ],
    insightRules: [
      {
        condition: (r) => r.estimatedRoas >= 3,
        level: "positive",
        title: "ROAS atrativo para teste",
        description: "ROAS projetado de 3x ou mais indica campanha promissora.",
      },
      {
        condition: (r) => r.estimatedRoi >= 100,
        level: "positive",
        title: "Boa campanha para fundo de funil",
        description: "ROI acima de 100% valida investimento em conversão.",
      },
      {
        condition: (r, i) => r.estimatedConversions > 0 && r.costPerConversion > i.valuePerConversion,
        level: "warning",
        title: "Conversão projetada abaixo da média",
        description: "CPA maior que o valor por conversão compromete a rentabilidade.",
      },
    ],
  },

  retention: {
    label: "Retenção",
    fields: [
      { key: "icpPercent", label: "% ICP", type: "percent", step: 0.1 },
      { key: "repurchaseRate", label: "Taxa de recompra (%)", type: "percent", step: 1 },
      { key: "repurchaseFrequency", label: "Frequência média de recompra", type: "number", step: 0.1, defaultValue: 1 },
      { key: "estimatedLtv", label: "LTV estimado (R$)", type: "currency", step: 50 },
      { key: "estimatedChurn", label: "Churn estimado (%)", type: "percent", step: 1 },
      { key: "reactivationRate", label: "Taxa de reativação (%)", type: "percent", step: 1 },
    ],
    resultCards: [
      { key: "retainedUsers", label: "Usuários retidos", format: "integer" },
      { key: "reactivatedUsers", label: "Usuários reativados", format: "integer" },
      { key: "activeUsers", label: "Base ativa total", format: "integer", highlight: true },
      { key: "estimatedRecurringRevenue", label: "Receita recorrente", format: "currency", highlight: true },
      { key: "costPerRetainedUser", label: "Custo por retido", format: "currency" },
      { key: "retentionRoi", label: "ROI de retenção", format: "percent", highlight: true },
      { key: "estimatedPayback", label: "Payback estimado", format: "months" },
    ],
    insightRules: [
      {
        condition: (r) => r.estimatedLtv > r.costPerRetainedUser && r.costPerRetainedUser > 0,
        level: "positive",
        title: "LTV sustenta investimento premium",
        description: "O valor vitalício do cliente supera o custo de aquisição.",
      },
      {
        condition: (r) => r.retentionRoi >= 100,
        level: "positive",
        title: "Bom creator para base ativa",
        description: "ROI de retenção acima de 100% indica estratégia sustentável.",
      },
      {
        condition: (r) => r.estimatedChurn > 30,
        level: "warning",
        title: "Churn projetado elevado",
        description: "Churn acima de 30% reduz significativamente a eficiência da campanha.",
      },
    ],
  },
};
