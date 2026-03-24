/**
 * IVS – Influencer Value Score Engine
 * Score 0-100 based on 5 pillars:
 *   1. ROI esperado (25pts)
 *   2. ICP match (20pts)
 *   3. Consistência de audiência (20pts)
 *   4. Eficiência de conversão (20pts)
 *   5. Nível de risco (15pts)
 */

export interface IvsInput {
  // ROI
  roi: number;             // % (ex: 200 = 200%)
  // ICP
  percIcp: number;         // % audiência qualificada
  // Consistência
  avgViewers: number;
  peakViewers: number;
  // Conversão
  ctr: number;             // %
  cvr: number;             // %
  // Risco extra
  volatility?: number;     // 0-1 (stddev/avg), 0 = estável
  dependencyOnPeaks?: number; // 0-1
}

export interface IvsResult {
  total: number;
  pillars: {
    roi: number;
    icpMatch: number;
    consistency: number;
    conversionEfficiency: number;
    riskLevel: number;
  };
  classification: IvsClassification;
  riskLabel: RiskLabel;
  riskFactors: string[];
}

export type IvsClassification = "Alto Valor" | "Boa Oportunidade" | "Moderado" | "Alto Risco";
export type RiskLabel = "Baixo" | "Médio" | "Alto";

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

/** Normalize a value into 0-1 using a logistic-like curve */
function norm(value: number, midpoint: number, steepness = 0.05): number {
  return 1 / (1 + Math.exp(-steepness * (value - midpoint)));
}

export function calculateIvs(input: IvsInput): IvsResult {
  // 1. ROI (25pts) – 200% = full marks, linear capped
  const roiScore = clamp((input.roi / 200) * 25, 0, 25);

  // 2. ICP match (20pts) – 50% = full, linear
  const icpScore = clamp((input.percIcp / 50) * 20, 0, 20);

  // 3. Consistência (20pts) – ratio avg/peak, closer to 1 = better
  let consistencyRatio = 1;
  if (input.peakViewers > 0) {
    consistencyRatio = input.avgViewers / input.peakViewers;
  }
  const consistencyScore = clamp(consistencyRatio * 20, 0, 20);

  // 4. Eficiência de conversão (20pts)
  // CTR benchmark: 2% = good → 10pts, CVR benchmark: 5% = good → 10pts
  const ctrScore = clamp((input.ctr / 2) * 10, 0, 10);
  const cvrScore = clamp((input.cvr / 5) * 10, 0, 10);
  const conversionScore = ctrScore + cvrScore;

  // 5. Risco (15pts) – lower volatility = higher score
  const vol = input.volatility ?? 0;
  const dep = input.dependencyOnPeaks ?? 0;
  const riskPenalty = (vol * 0.6 + dep * 0.4);
  const riskScore = clamp((1 - riskPenalty) * 15, 0, 15);

  const total = Math.round(roiScore + icpScore + consistencyScore + conversionScore + riskScore);

  // Classification
  let classification: IvsClassification;
  if (total >= 80) classification = "Alto Valor";
  else if (total >= 60) classification = "Boa Oportunidade";
  else if (total >= 40) classification = "Moderado";
  else classification = "Alto Risco";

  // Risk factors
  const riskFactors: string[] = [];
  if (consistencyRatio < 0.3) riskFactors.push("Alta volatilidade de audiência (avg << peak)");
  if (input.percIcp < 10) riskFactors.push("Baixo ICP (< 10%)");
  if (input.ctr < 0.5) riskFactors.push("CTR muito baixo (< 0.5%)");
  if (input.cvr < 1) riskFactors.push("CVR muito baixo (< 1%)");
  if (input.roi < 0) riskFactors.push("ROI negativo – prejuízo projetado");
  if (vol > 0.5) riskFactors.push("Alta dependência de picos");

  let riskLabel: RiskLabel;
  if (riskFactors.length === 0) riskLabel = "Baixo";
  else if (riskFactors.length <= 2) riskLabel = "Médio";
  else riskLabel = "Alto";

  return {
    total: clamp(total, 0, 100),
    pillars: {
      roi: Math.round(roiScore * 10) / 10,
      icpMatch: Math.round(icpScore * 10) / 10,
      consistency: Math.round(consistencyScore * 10) / 10,
      conversionEfficiency: Math.round(conversionScore * 10) / 10,
      riskLevel: Math.round(riskScore * 10) / 10,
    },
    classification,
    riskLabel,
    riskFactors,
  };
}

/** Benchmark data for market comparison */
export const MARKET_BENCHMARKS = {
  roi: { label: "ROI médio do mercado", value: 150, unit: "%" },
  cpa: { label: "CPA médio do mercado", value: 250, unit: "R$" },
  ctr: { label: "CTR médio do mercado", min: 0.8, max: 2.5, unit: "%" },
};

export type BenchmarkResult = "above" | "average" | "below";

export function compareToBenchmark(value: number, benchmark: number, higherIsBetter = true): BenchmarkResult {
  const ratio = value / benchmark;
  if (higherIsBetter) {
    if (ratio >= 1.2) return "above";
    if (ratio >= 0.8) return "average";
    return "below";
  } else {
    if (ratio <= 0.8) return "above";
    if (ratio <= 1.2) return "average";
    return "below";
  }
}

/** Fair price range based on target ROI */
export function calculateFairPrice(params: {
  estimatedRevenue: number;
  targetRoi?: number; // default 3x = 300%
}): { min: number; max: number } {
  const target = (params.targetRoi ?? 300) / 100;
  const maxFee = params.estimatedRevenue / (1 + target);
  const minFee = maxFee * 0.6; // 60% of max = conservative
  return {
    min: Math.max(0, Math.round(minFee)),
    max: Math.max(0, Math.round(maxFee)),
  };
}
