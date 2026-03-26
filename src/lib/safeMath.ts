export function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  return denominator !== 0 ? numerator / denominator : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function safePercent(value: number, total: number): number {
  return safeDivide(value, total) * 100;
}
