/**
 * Treasury Metrics — Batch 4 Phase 9
 *
 * Tracks:
 *   forecast_accuracy      — % of forecasts within 10% variance
 *   forecast_latency_ms    — time to compute forecast
 *   variance_latency_ms    — time to compute variance
 *   cash_position_latency_ms — time to compute cash position
 *   dashboard_latency_ms   — time to build full dashboard
 *   liquidity_latency_ms   — time to compute liquidity
 *   risk_detection_latency_ms — time to detect risks
 *   cache_hit_ratio        — from treasuryCache.stats()
 */

interface MetricPoint {
  name: string;
  value: number;
  tags: Record<string, number | string>;
  recordedAt: number; // epoch ms
}

// Ring buffer — keep last 1000 metric points in memory
const MAX_POINTS = 1000;
const metricBuffer: MetricPoint[] = [];

export function recordMetric(
  name: string,
  value: number,
  tags: Record<string, number | string> = {}
): void {
  if (metricBuffer.length >= MAX_POINTS) {
    metricBuffer.shift(); // evict oldest
  }
  metricBuffer.push({ name, value, tags, recordedAt: Date.now() });
}

export interface MetricSummary {
  name: string;
  count: number;
  min: number;
  max: number;
  avg: number;
  p95: number;
  lastValue: number;
}

export function getMetricSummary(
  name: string,
  sinceMs = 3_600_000 // last 1 hour
): MetricSummary | null {
  const cutoff = Date.now() - sinceMs;
  const points = metricBuffer.filter(p => p.name === name && p.recordedAt >= cutoff);
  if (points.length === 0) return null;

  const values = points.map(p => p.value).sort((a, b) => a - b);
  const sum = values.reduce((s, v) => s + v, 0);
  const p95idx = Math.floor(values.length * 0.95);

  return {
    name,
    count:     values.length,
    min:       values[0],
    max:       values[values.length - 1],
    avg:       Math.round((sum / values.length) * 100) / 100,
    p95:       values[p95idx] ?? values[values.length - 1],
    lastValue: values[values.length - 1],
  };
}

export function getAllMetricsSummary(): MetricSummary[] {
  const names = new Set(metricBuffer.map(p => p.name));
  return Array.from(names)
    .map(n => getMetricSummary(n))
    .filter((s): s is MetricSummary => s !== null);
}

/** Compute forecast accuracy: % of variance rows where |variancePct| ≤ 10 */
export function computeForecastAccuracy(
  variancePcts: (number | null)[]
): number | null {
  const valid = variancePcts.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  const accurate = valid.filter(v => Math.abs(v) <= 10).length;
  return Math.round((accurate / valid.length) * 10000) / 100; // %
}
