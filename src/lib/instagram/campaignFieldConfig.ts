import type { CampaignConfig, TranslationKey } from "./campaignTypes";

type TFunc = (key: string) => string;

export function getCampaignConfigs(t: TFunc): Record<string, CampaignConfig> {
  return {
    igaming: {
      label: "iGaming",
      fields: [
        { key: "icpPercent", label: t("cf.icp_percent"), type: "percent", step: 0.1 },
        { key: "estimatedCtr", label: t("cf.estimated_ctr"), type: "percent", step: 0.1 },
        { key: "registrationRate", label: t("cf.registration_rate"), type: "percent", step: 0.1 },
        { key: "ftdRate", label: t("cf.ftd_rate"), type: "percent", step: 0.1 },
        { key: "valuePerFtd", label: t("cf.value_per_ftd"), type: "currency", step: 50 },
        { key: "avgTicket", label: t("cf.avg_ticket"), type: "currency", step: 50 },
        { key: "profitMargin", label: t("cf.profit_margin"), type: "percent", step: 1 },
      ],
      resultCards: [
        { key: "qualifiedAudience", label: t("cf.qualified_audience"), format: "integer" },
        { key: "estimatedClicks", label: t("cf.estimated_clicks"), format: "integer" },
        { key: "estimatedRegistrations", label: t("cf.estimated_registrations"), format: "integer" },
        { key: "estimatedFtds", label: t("cf.estimated_ftds"), format: "integer", highlight: true },
        { key: "estimatedRevenue", label: t("cf.estimated_revenue"), format: "currency", highlight: true },
        { key: "estimatedCpa", label: t("cf.estimated_cpa"), format: "currency", highlight: true },
        { key: "estimatedRoi", label: t("cf.estimated_roi"), format: "percent", highlight: true },
        { key: "recommendedMaxFee", label: t("cf.recommended_max_fee"), format: "currency" },
      ],
      insightRules: [
        {
          condition: (r) => r.estimatedRoi >= 200,
          level: "positive",
          title: t("insight.igaming_good_roi"),
          description: t("insight.igaming_good_roi_desc"),
        },
        {
          condition: (r) => r.estimatedRoi >= 100 && r.estimatedRoi < 200,
          level: "neutral",
          title: t("insight.igaming_viable"),
          description: t("insight.igaming_viable_desc"),
        },
        {
          condition: (r) => r.estimatedRoi < 100 && r.estimatedRoi !== 0,
          level: "warning",
          title: t("insight.igaming_low_roi"),
          description: t("insight.igaming_low_roi_desc"),
        },
        {
          condition: (r, i) => i.influencerFee > r.recommendedMaxFee && r.recommendedMaxFee > 0,
          level: "warning",
          title: t("insight.igaming_fee_high"),
          description: t("insight.igaming_fee_high_desc"),
        },
      ],
    },

    awareness: {
      label: "Awareness",
      fields: [
        { key: "icpPercent", label: t("cf.icp_percent"), type: "percent", step: 0.1 },
        { key: "averageFrequency", label: t("cf.avg_frequency"), type: "number", step: 0.1, defaultValue: 1 },
        { key: "benchmarkCpm", label: t("cf.benchmark_cpm"), type: "currency", step: 1 },
        { key: "qualifiedReachRate", label: t("cf.qualified_reach_rate"), type: "percent", step: 0.1 },
      ],
      resultCards: [
        { key: "estimatedImpressions", label: t("cf.estimated_impressions"), format: "integer" },
        { key: "estimatedUniqueReach", label: t("cf.estimated_unique_reach"), format: "integer", highlight: true },
        { key: "qualifiedReach", label: t("cf.qualified_reach"), format: "integer", highlight: true },
        { key: "realCpm", label: t("cf.real_cpm"), format: "currency", highlight: true },
        { key: "costPerReachedUser", label: t("cf.cost_per_reached_user"), format: "currency" },
        { key: "qualifiedCpm", label: t("cf.qualified_cpm"), format: "currency", highlight: true },
      ],
      insightRules: [
        {
          condition: (r, i) => r.realCpm < i.benchmarkCpm && i.benchmarkCpm > 0,
          level: "positive",
          title: t("insight.awareness_efficient"),
          description: t("insight.awareness_efficient_desc"),
        },
        {
          condition: (r, i) => r.qualifiedCpm < i.benchmarkCpm && i.benchmarkCpm > 0,
          level: "positive",
          title: t("insight.awareness_low_cpm"),
          description: t("insight.awareness_low_cpm_desc"),
        },
        {
          condition: (r) => r.averageFrequency < 1.5 && r.averageFrequency > 0,
          level: "warning",
          title: t("insight.awareness_low_freq"),
          description: t("insight.awareness_low_freq_desc"),
        },
        {
          condition: (r) => r.averageFrequency >= 2 && r.averageFrequency <= 4,
          level: "positive",
          title: t("insight.awareness_good_freq"),
          description: t("insight.awareness_good_freq_desc"),
        },
      ],
    },

    consideration: {
      label: t("campaign.consideration"),
      fields: [
        { key: "icpPercent", label: t("cf.icp_percent"), type: "percent", step: 0.1 },
        { key: "estimatedCtr", label: t("cf.estimated_ctr"), type: "percent", step: 0.1 },
        { key: "contentRetentionRate", label: t("cf.content_retention_rate"), type: "percent", step: 1 },
        { key: "qualifiedEngagementRate", label: t("cf.qualified_engagement_rate"), type: "percent", step: 0.1 },
        { key: "benchmarkCpc", label: t("cf.benchmark_cpc"), type: "currency", step: 0.5 },
      ],
      resultCards: [
        { key: "estimatedClicks", label: t("cf.estimated_clicks"), format: "integer" },
        { key: "engagedUsers", label: t("cf.engaged_users"), format: "integer", highlight: true },
        { key: "qualifiedTraffic", label: t("cf.qualified_traffic"), format: "integer" },
        { key: "estimatedCpc", label: t("cf.estimated_cpc"), format: "currency", highlight: true },
        { key: "costPerEngagedUser", label: t("cf.cost_per_engaged_user"), format: "currency" },
        { key: "considerationScore", label: t("cf.consideration_score"), format: "integer", highlight: true },
      ],
      insightRules: [
        {
          condition: (r, i) => r.estimatedCpc < i.benchmarkCpc && i.benchmarkCpc > 0,
          level: "positive",
          title: t("insight.consideration_cpc"),
          description: t("insight.consideration_cpc_desc"),
        },
        {
          condition: (r) => r.contentRetentionRate >= 35,
          level: "positive",
          title: t("insight.consideration_interest"),
          description: t("insight.consideration_interest_desc"),
        },
        {
          condition: (r) => r.contentRetentionRate > 0 && r.contentRetentionRate < 20,
          level: "warning",
          title: t("insight.consideration_low_ret"),
          description: t("insight.consideration_low_ret_desc"),
        },
        {
          condition: (r) => r.considerationScore >= 70,
          level: "positive",
          title: t("insight.consideration_good_score"),
          description: t("insight.consideration_good_score_desc"),
        },
      ],
    },

    conversion: {
      label: t("campaign.conversion"),
      fields: [
        { key: "icpPercent", label: t("cf.icp_percent"), type: "percent", step: 0.1 },
        { key: "estimatedCtr", label: t("cf.estimated_ctr"), type: "percent", step: 0.1 },
        { key: "finalConversionRate", label: t("cf.final_conversion_rate"), type: "percent", step: 0.1 },
        { key: "valuePerConversion", label: t("cf.value_per_conversion"), type: "currency", step: 50 },
        { key: "conversionMargin", label: t("cf.conversion_margin"), type: "percent", step: 1 },
      ],
      resultCards: [
        { key: "estimatedClicks", label: t("cf.estimated_clicks"), format: "integer" },
        { key: "estimatedConversions", label: t("cf.estimated_conversions"), format: "integer", highlight: true },
        { key: "estimatedRevenue", label: t("cf.estimated_revenue"), format: "currency", highlight: true },
        { key: "costPerConversion", label: t("cf.cost_per_conversion"), format: "currency", highlight: true },
        { key: "estimatedRoi", label: t("cf.estimated_roi"), format: "percent", highlight: true },
        { key: "estimatedRoas", label: t("cf.estimated_roas"), format: "decimal", highlight: true },
      ],
      insightRules: [
        {
          condition: (r) => r.estimatedRoas >= 3,
          level: "positive",
          title: t("insight.conversion_roas"),
          description: t("insight.conversion_roas_desc"),
        },
        {
          condition: (r) => r.estimatedRoi >= 100,
          level: "positive",
          title: t("insight.conversion_roi"),
          description: t("insight.conversion_roi_desc"),
        },
        {
          condition: (r, i) => r.estimatedConversions > 0 && r.costPerConversion > i.valuePerConversion,
          level: "warning",
          title: t("insight.conversion_cpa_high"),
          description: t("insight.conversion_cpa_high_desc"),
        },
      ],
    },

    retention: {
      label: t("campaign.retention"),
      fields: [
        { key: "icpPercent", label: t("cf.icp_percent"), type: "percent", step: 0.1 },
        { key: "repurchaseRate", label: t("cf.repurchase_rate"), type: "percent", step: 1 },
        { key: "repurchaseFrequency", label: t("cf.repurchase_frequency"), type: "number", step: 0.1, defaultValue: 1 },
        { key: "estimatedLtv", label: t("cf.estimated_ltv"), type: "currency", step: 50 },
        { key: "estimatedChurn", label: t("cf.estimated_churn"), type: "percent", step: 1 },
        { key: "reactivationRate", label: t("cf.reactivation_rate"), type: "percent", step: 1 },
      ],
      resultCards: [
        { key: "retainedUsers", label: t("cf.retained_users"), format: "integer" },
        { key: "reactivatedUsers", label: t("cf.reactivated_users"), format: "integer" },
        { key: "activeUsers", label: t("cf.active_users"), format: "integer", highlight: true },
        { key: "estimatedRecurringRevenue", label: t("cf.estimated_recurring_revenue"), format: "currency", highlight: true },
        { key: "costPerRetainedUser", label: t("cf.cost_per_retained_user"), format: "currency" },
        { key: "retentionRoi", label: t("cf.retention_roi"), format: "percent", highlight: true },
        { key: "estimatedPayback", label: t("cf.estimated_payback"), format: "months" },
      ],
      insightRules: [
        {
          condition: (r) => r.estimatedLtv > r.costPerRetainedUser && r.costPerRetainedUser > 0,
          level: "positive",
          title: t("insight.retention_ltv"),
          description: t("insight.retention_ltv_desc"),
        },
        {
          condition: (r) => r.retentionRoi >= 100,
          level: "positive",
          title: t("insight.retention_roi"),
          description: t("insight.retention_roi_desc"),
        },
        {
          condition: (r) => r.estimatedChurn > 30,
          level: "warning",
          title: t("insight.retention_churn"),
          description: t("insight.retention_churn_desc"),
        },
      ],
    },
  };
}

// Keep backward-compatible export for any imports that don't pass t
// This uses Portuguese fallback keys directly
export const campaignConfigs = getCampaignConfigs((k) => k);
