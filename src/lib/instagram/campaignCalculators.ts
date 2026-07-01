import { safeDivide } from "@/lib/safeMath";
import type { CampaignType } from "./campaignTypes";

type Inputs = Record<string, number>;

/**
 * Base audience passed in from the platform tab (Instagram alcance, Twitch/YT/Kick/TikTok
 * unique reach or views totals). CPM/CPE benchmarks are used ONLY for comparison —
 * never as a source to derive audience.
 */
function baseReach(i: Inputs): number {
  return Math.max(i.avgReach || 0, 0);
}

const calculators: Record<CampaignType, (inputs: Inputs) => Record<string, number>> = {
  igaming: (i) => {
    const base = baseReach(i);
    const qualified = base * ((i.icpPercent || 0) / 100);
    const estimatedImpressions = qualified;
    const estimatedClicks = qualified * ((i.estimatedCtr || 0) / 100);
    const estimatedFtds = estimatedClicks * ((i.ftdRate || 0) / 100);
    const estimatedRevenue = estimatedFtds * (i.valuePerFtd || 0);
    const fee = i.influencerFee || 0;
    const estimatedCpa = estimatedFtds > 0 ? safeDivide(fee, estimatedFtds) : 0;
    const estimatedRoas = fee > 0 ? safeDivide(estimatedRevenue, fee) : 0;

    return { estimatedImpressions, estimatedClicks, estimatedFtds, estimatedRevenue, estimatedCpa, estimatedRoas };
  },

  awareness: (i) => {
    const base = baseReach(i);
    const freq = Math.max(i.averageFrequency || 1, 1);
    const estimatedUniqueReach = base;
    const estimatedImpressions = base * freq;
    const rate = i.qualifiedReachRate || i.icpPercent || 0;
    const qualifiedReach = estimatedUniqueReach * (rate / 100);
    const fee = i.influencerFee || 0;
    const effectiveCpm = estimatedImpressions > 0 ? safeDivide(fee, estimatedImpressions) * 1000 : 0;

    return { estimatedImpressions, estimatedUniqueReach, qualifiedReach, effectiveCpm };
  },

  consideration: (i) => {
    const base = baseReach(i);
    const qualified = base * ((i.icpPercent || 0) / 100);
    const engagedUsers = qualified * ((i.qualifiedEngagementRate || 0) / 100);
    const estimatedClicks = qualified * ((i.estimatedCtr || 0) / 100);
    const considerationReach = qualified;
    const fee = i.influencerFee || 0;
    const estimatedCpe = engagedUsers > 0 ? safeDivide(fee, engagedUsers) : 0;

    return { engagedUsers, estimatedClicks, considerationReach, estimatedCpe };
  },

  conversion: (i) => {
    const base = baseReach(i);
    const qualified = base * ((i.icpPercent || 0) / 100);
    const estimatedClicks = qualified * ((i.estimatedCtr || 0) / 100);
    const estimatedConversions = estimatedClicks * ((i.finalConversionRate || 0) / 100);
    const fee = i.influencerFee || 0;
    const costPerConversion = estimatedConversions > 0 ? safeDivide(fee, estimatedConversions) : 0;
    const productValue = i.productValue || 0;
    const estimatedRevenue = productValue > 0 ? estimatedConversions * productValue : 0;
    const estimatedRoas = productValue > 0 && fee > 0 ? safeDivide(estimatedRevenue, fee) : 0;

    return { estimatedClicks, estimatedConversions, costPerConversion, estimatedRevenue, estimatedRoas };
  },

  retention: (i) => {
    const base = baseReach(i);
    const qualified = base * ((i.icpPercent || 0) / 100);
    const retainedUsers = qualified * ((i.repurchaseRate || 0) / 100);
    const freq = Math.max(i.repurchaseFrequency || 1, 1);
    const estimatedRepurchases = retainedUsers * freq;
    const fee = i.influencerFee || 0;
    const costPerRetainedUser = retainedUsers > 0 ? safeDivide(fee, retainedUsers) : 0;
    const productValue = i.productValue || 0;
    const estimatedLtv = productValue > 0 ? productValue * freq : 0;
    const estimatedRecurringRevenue = productValue > 0 ? retainedUsers * estimatedLtv : 0;

    return { retainedUsers, estimatedRepurchases, costPerRetainedUser, estimatedLtv, estimatedRecurringRevenue };
  },
};

export function calculateCampaign(type: CampaignType, inputs: Inputs): Record<string, number> {
  return calculators[type](inputs);
}
