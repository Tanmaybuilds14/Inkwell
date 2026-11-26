/**
 * Latency aggregation for the perf harnesses.
 *
 * Nearest-rank percentiles (the definition Artillery/HdrHistogram dashboards
 * quote for p50/p95/p99) computed over the raw samples each virtual client
 * records — deliberately dependency-free so a run needs nothing but Node.
 */

/** Nearest-rank percentile. Returns null for an empty sample set. */
export function percentile(values, p) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length, Math.max(1, rank)) - 1;
  return sorted[idx];
}

/** Count how many samples exceed `thresholdMs`. */
export function countAbove(values, thresholdMs) {
  let n = 0;
  for (const v of values) if (v > thresholdMs) n += 1;
  return n;
}

/**
 * Summarise a sample set. `p97` is included explicitly because the plan's SLA
 * is stated at p50/p97/p99.
 */
export function summarize(values, { unit = 'ms' } = {}) {
  const samples = (values ?? []).filter((v) => Number.isFinite(v));
  if (samples.length === 0) {
    return { count: 0, unit, min: null, mean: null, p50: null, p97: null, p99: null, max: null };
  }
  const total = samples.reduce((a, b) => a + b, 0);
  return {
    count: samples.length,
    unit,
    min: round(Math.min(...samples)),
    mean: round(total / samples.length),
    p50: round(percentile(samples, 50)),
    p97: round(percentile(samples, 97)),
    p99: round(percentile(samples, 99)),
    max: round(Math.max(...samples)),
  };
}

const round = (v) => (v === null ? null : Math.round(v * 100) / 100);

/** Render summaries as an aligned text table (what the harness prints). */
export function table(rows) {
  const header = ['metric', 'count', 'min', 'mean', 'p50', 'p97', 'p99', 'max'];
  const cells = rows.map(({ metric, summary }) => [
    metric,
    String(summary.count),
    fmt(summary.min),
    fmt(summary.mean),
    fmt(summary.p50),
    fmt(summary.p97),
    fmt(summary.p99),
    fmt(summary.max),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...cells.map((row) => String(row[i]).length))
  );
  const line = (row) => row.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  const divider = widths.map((w) => '-'.repeat(w)).join('  ');
  return [line(header), divider, ...cells.map(line)].join('\n');
}

const fmt = (v) => (v === null || v === undefined ? '-' : String(v));

/**
 * Count occurrences of each distinct value (e.g. WebSocket close codes), so a
 * run can say WHY sessions ended: 4408 = throttled, 4404 = document missing,
 * 4401/4403 = auth denied, 1006 = the peer vanished (the kill scenario).
 */
export function tally(values) {
  const counts = {};
  for (const v of values ?? []) counts[v] = (counts[v] ?? 0) + 1;
  return counts;
}

/** The SLA check the plan uses to define "max users": p99 and error rate. */
export function slaVerdict({ updateRtt, errorRate, p99LimitMs = 300, maxErrorRate = 0.01 }) {
  const p99 = updateRtt?.p99 ?? null;
  const latencyOk = p99 !== null && p99 <= p99LimitMs;
  const errorsOk = errorRate <= maxErrorRate;
  return { ok: latencyOk && errorsOk, latencyOk, errorsOk, p99, p99LimitMs, errorRate, maxErrorRate };
}
