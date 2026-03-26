import { safeDivide, clamp } from "@/lib/safeMath";
import type { CampaignType } from "./campaignTypes";

type Inputs = Record<string, number>;

/** Combined base audience from Reels + Stories, preferring reach or views */
function getBase(inputs: Inputs, preferReach = true): number {
  // Weighted total exposure across both formats
  const reelsTotal = (inputs.reelsViews || 0) * Math.max(inputs.reelsDeliveries || 0, 1);
  const storiesTotal = (inputs.storiesViews || 0) * Math.max(inputs.storiesDeliveries || 0, 1);
  const viewsBase = reelsTotal + storiesTotal;

  const reachBase = inputs.avgReach || 0;
  const totalDeliveries = (inputs.reelsDeliveries || 0) + (inputs.storiesDeliveries || 0);
  const reachTotal = reachBase * Math.max(totalDeliveries, 1);

  if (preferReach) return reachTotal > 0 ? reachTotal : viewsBase;
  return viewsBase > 0 ? viewsBase : reachTotal;
}

/** Single-delivery base (avg per content) */
function getBasePerContent(inputs: Inputs, preferReach = true): number {
  const reelsViews = inputs.reelsViews || 0;
  const storiesViews = inputs.storiesViews || 0;
  const avgViews = reelsViews > 0 && storiesViews > 0
    ? (reelsViews + storiesViews) / 2
    : reelsViews || storiesViews;
  const reach = inputs.avgReach || 0;

  if (preferReach) return reach > 0 ? reach : avgViews;
  return avgViews > 0 ? avgViews : reach;
}


const calculators: Record<CampaignType, (inputs: Inputs) => Record<string, number>> = {
  igaming: (i) => {
    const base = getBasePerContent(i);
    const qualifiedAudience = base * (i.icpPercent / 100);
    const estimatedClicks = qualifiedAudience * (i.estimatedCtr / 100);
    const estimatedRegistrations = estimatedClicks * (i.registrationRate / 100);
    const estimatedFtds = estimatedRegistrations * (i.ftdRate / 100);
    const estimatedRevenue = estimatedFtds * i.valuePerFtd;
    const estimatedRevenueAlt = i.avgTicket > 0 && i.profitMargin > 0
      ? estimatedFtds * i.avgTicket * (i.profitMargin / 100)
      : 0;
    const estimatedCpa = safeDivide(i.influencerFee, Math.max(estimatedFtds, 1));
    const estimatedRoi = safeDivide((estimatedRevenue - i.influencerFee), Math.max(i.influencerFee, 1)) * 100;
    const recommendedMaxFee = safeDivide(estimatedRevenue, 3);

    return {
      qualifiedAudience, estimatedClicks, estimatedRegistrations,
      estimatedFtds, estimatedRevenue, estimatedRevenueAlt,
      estimatedCpa, estimatedRoi, recommendedMaxFee,
    };
  },

  awareness: (i) => {
    const totalExposure = getBase(i);
    const freq = Math.max(i.averageFrequency || 1, 1);
    const estimatedImpressions = totalExposure * freq;
    const estimatedUniqueReach = totalExposure;
    const effectiveRate = i.qualifiedReachRate > 0 ? i.qualifiedReachRate : i.icpPercent;
    const qualifiedReach = estimatedUniqueReach * (effectiveRate / 100);
    const realCpm = safeDivide(i.influencerFee, Math.max(estimatedImpressions, 1)) * 1000;
    const costPerReachedUser = safeDivide(i.influencerFee, Math.max(estimatedUniqueReach, 1));
    const qualifiedCpm = safeDivide(i.influencerFee, Math.max(qualifiedReach, 1)) * 1000;

    return {
      estimatedImpressions, estimatedUniqueReach, qualifiedReach,
      averageFrequency: freq, realCpm, costPerReachedUser, qualifiedCpm,
    };
  },

  consideration: (i) => {
    const base = getBasePerContent(i, false);
    const qualifiedAudience = base * (i.icpPercent / 100);
    const estimatedClicks = qualifiedAudience * (i.estimatedCtr / 100);
    const engagedUsers = qualifiedAudience * (i.qualifiedEngagementRate / 100);
    const qualifiedTraffic = estimatedClicks * (i.contentRetentionRate / 100);
    const estimatedCpc = safeDivide(i.influencerFee, Math.max(estimatedClicks, 1));
    const costPerEngagedUser = safeDivide(i.influencerFee, Math.max(engagedUsers, 1));
    const considerationScore = clamp(
      (i.estimatedCtr * 0.35) + (i.contentRetentionRate * 0.40) + (i.qualifiedEngagementRate * 0.25),
      0, 100
    );

    return {
      estimatedClicks, engagedUsers, qualifiedTraffic,
      estimatedCpc, costPerEngagedUser, considerationScore,
      contentRetentionRate: i.contentRetentionRate,
    };
  },

  conversion: (i) => {
    const totalExposure = getBase(i);
    const qualifiedAudience = totalExposure * (i.icpPercent / 100);
    const estimatedClicks = qualifiedAudience * (i.estimatedCtr / 100);
    const estimatedConversions = estimatedClicks * (i.finalConversionRate / 100);
    const grossRevenue = estimatedConversions * i.valuePerConversion;
    const estimatedRevenue = i.conversionMargin > 0
      ? grossRevenue * (i.conversionMargin / 100)
      : grossRevenue;
    const costPerConversion = safeDivide(i.influencerFee, Math.max(estimatedConversions, 1));
    const estimatedRoi = safeDivide((estimatedRevenue - i.influencerFee), Math.max(i.influencerFee, 1)) * 100;
    const estimatedRoas = safeDivide(estimatedRevenue, Math.max(i.influencerFee, 1));

    return {
      estimatedClicks, estimatedConversions, estimatedRevenue,
      costPerConversion, estimatedRoi, estimatedRoas,
    };
  },

  retention: (i) => {
    const base = getBasePerContent(i);
    const qualifiedAudience = base * (i.icpPercent / 100);
    const retainedUsers = qualifiedAudience * (i.repurchaseRate / 100);
    const reactivatedUsers = qualifiedAudience * (i.reactivationRate / 100);
    const activeUsers = retainedUsers + reactivatedUsers;
    const freq = Math.max(i.repurchaseFrequency || 1, 1);
    const churnFactor = 1 - (i.estimatedChurn / 100);
    const estimatedRecurringRevenue = activeUsers * i.estimatedLtv * freq * churnFactor;
    const costPerRetainedUser = safeDivide(i.influencerFee, Math.max(activeUsers, 1));
    const retentionRoi = safeDivide((estimatedRecurringRevenue - i.influencerFee), Math.max(i.influencerFee, 1)) * 100;
    const monthlyRevenue = safeDivide(estimatedRecurringRevenue, 12);
    const estimatedPayback = safeDivide(i.influencerFee, Math.max(monthlyRevenue, 1));

    return {
      retainedUsers, reactivatedUsers, activeUsers,
      estimatedRecurringRevenue, costPerRetainedUser, retentionRoi,
      estimatedPayback, estimatedLtv: i.estimatedLtv, estimatedChurn: i.estimatedChurn,
    };
  },
};

export function calculateCampaign(type: CampaignType, inputs: Inputs): Record<string, number> {
  return calculators[type](inputs);
}
