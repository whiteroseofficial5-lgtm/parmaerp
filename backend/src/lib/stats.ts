// Small, dependency-free statistics used by forecasting and anomaly detection.
export const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const std = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

/** Holt's linear-trend exponential smoothing. Small, transparent, and robust for short monthly series. */
export function holt(series: number[], horizon = 3, alpha = 0.5, beta = 0.3) {
  if (series.length === 0) return { forecast: Array(horizon).fill(0), sigma: 0 };
  if (series.length === 1) return { forecast: Array(horizon).fill(series[0]), sigma: 0 };
  let level = series[0], trend = series[1] - series[0];
  const residuals: number[] = [];
  for (let t = 1; t < series.length; t++) {
    const pred = level + trend;
    residuals.push(series[t] - pred);
    const prev = level;
    level = alpha * series[t] + (1 - alpha) * (level + trend);
    trend = beta * (level - prev) + (1 - beta) * trend;
  }
  const sigma = std(residuals);
  return { forecast: Array.from({ length: horizon }, (_, h) => Math.max(0, level + (h + 1) * trend)), sigma };
}

