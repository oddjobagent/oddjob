/**
 * Pure aggregation helpers for `oddjob eval`.
 *
 * Decoupled from runOnce so they're trivially unit-testable. The CLI command
 * produces `RunMetricRow[]` (one row per case) and feeds it here for the
 * report shape; baseline diffing is symmetric so the same shape compares.
 */

/** Per-case metrics extracted from a runOnce result. */
export interface RunMetricRow {
  caseId: string;
  passed: boolean;
  /** Wall-clock duration ms. */
  durationMs: number;
  /** Total input tokens billed. */
  tokensIn: number;
  /** Total output tokens billed. */
  tokensOut: number;
  /** Cache-read tokens (Anthropic prompt cache hit). */
  cacheRead: number;
  /** Cache-write tokens. */
  cacheWrite: number;
  /** Aggregate cost in USD. */
  costUsd: number;
  /** Total tool invocations across the run. */
  toolCalls: number;
  /** Tool invocations that returned isError. */
  toolErrors: number;
  /** Total assistant turns (LLM iterations). */
  turns: number;
  /** Per-tool error count, keyed by tool name. */
  perToolErrors?: Record<string, number>;
  /** Per-tool invocation count, keyed by tool name. */
  perToolCalls?: Record<string, number>;
}

export interface EvalReport {
  generatedAt: number;
  cases: number;
  passed: number;
  passRate: number;
  /** Wall-clock p50 / p95 ms. */
  p50Ms: number;
  p95Ms: number;
  meanTokensIn: number;
  meanTokensOut: number;
  meanCacheRead: number;
  meanCacheWrite: number;
  /** cacheRead / (cacheRead + tokensIn) across the whole report (0 when undefined). */
  cacheHitRatio: number;
  /** Total $ across all runs. */
  totalCostUsd: number;
  /** Mean $/run. */
  meanCostUsd: number;
  /** Total $ / passed runs. NaN-safe (Infinity sentinel when zero passes). */
  costPerSuccessUsd: number;
  meanToolCalls: number;
  meanTurns: number;
  /** Aggregate per-tool error rate keyed by tool name (errors / calls). */
  perToolErrorRate: Record<string, number>;
  rows: RunMetricRow[];
}

export interface EvalDiff {
  passRateDelta: number;
  p50MsDelta: number;
  p95MsDelta: number;
  meanTokensInDelta: number;
  meanTokensOutDelta: number;
  meanCacheReadDelta: number;
  meanCacheWriteDelta: number;
  cacheHitRatioDelta: number;
  totalCostUsdDelta: number;
  meanCostUsdDelta: number;
  /** Δ cost/success. Both sides may be Infinity; in that case the delta is 0. */
  costPerSuccessUsdDelta: number;
  meanToolCallsDelta: number;
  meanTurnsDelta: number;
}

const ZERO_REPORT: EvalReport = {
  generatedAt: 0,
  cases: 0,
  passed: 0,
  passRate: 0,
  p50Ms: 0,
  p95Ms: 0,
  meanTokensIn: 0,
  meanTokensOut: 0,
  meanCacheRead: 0,
  meanCacheWrite: 0,
  cacheHitRatio: 0,
  totalCostUsd: 0,
  meanCostUsd: 0,
  costPerSuccessUsd: 0,
  meanToolCalls: 0,
  meanTurns: 0,
  perToolErrorRate: {},
  rows: [],
};

/** Aggregate a list of per-case rows into a single report. */
export function aggregateRunMetrics(
  rows: readonly RunMetricRow[],
  generatedAt: number = Date.now(),
): EvalReport {
  if (rows.length === 0) return { ...ZERO_REPORT, generatedAt };

  const n = rows.length;
  const passed = rows.reduce((acc, r) => acc + (r.passed ? 1 : 0), 0);
  const sumTokensIn = rows.reduce((a, r) => a + r.tokensIn, 0);
  const sumTokensOut = rows.reduce((a, r) => a + r.tokensOut, 0);
  const sumCacheRead = rows.reduce((a, r) => a + r.cacheRead, 0);
  const sumCacheWrite = rows.reduce((a, r) => a + r.cacheWrite, 0);
  const sumCost = rows.reduce((a, r) => a + r.costUsd, 0);
  const sumToolCalls = rows.reduce((a, r) => a + r.toolCalls, 0);
  const sumTurns = rows.reduce((a, r) => a + r.turns, 0);

  const cacheDenom = sumCacheRead + sumTokensIn;
  const cacheHitRatio = cacheDenom > 0 ? sumCacheRead / cacheDenom : 0;

  const perToolErrorRate: Record<string, number> = {};
  const perToolCallsAgg: Record<string, number> = {};
  const perToolErrorsAgg: Record<string, number> = {};
  for (const r of rows) {
    if (r.perToolCalls) {
      for (const [k, v] of Object.entries(r.perToolCalls)) {
        perToolCallsAgg[k] = (perToolCallsAgg[k] ?? 0) + v;
      }
    }
    if (r.perToolErrors) {
      for (const [k, v] of Object.entries(r.perToolErrors)) {
        perToolErrorsAgg[k] = (perToolErrorsAgg[k] ?? 0) + v;
      }
    }
  }
  for (const [tool, calls] of Object.entries(perToolCallsAgg)) {
    const errs = perToolErrorsAgg[tool] ?? 0;
    perToolErrorRate[tool] = calls > 0 ? errs / calls : 0;
  }

  const durations = rows.map((r) => r.durationMs).toSorted((a, b) => a - b);

  return {
    generatedAt,
    cases: n,
    passed,
    passRate: passed / n,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    meanTokensIn: sumTokensIn / n,
    meanTokensOut: sumTokensOut / n,
    meanCacheRead: sumCacheRead / n,
    meanCacheWrite: sumCacheWrite / n,
    cacheHitRatio,
    totalCostUsd: sumCost,
    meanCostUsd: sumCost / n,
    costPerSuccessUsd: passed > 0 ? sumCost / passed : Number.POSITIVE_INFINITY,
    meanToolCalls: sumToolCalls / n,
    meanTurns: sumTurns / n,
    perToolErrorRate,
    rows: [...rows],
  };
}

/** Compute b - a deltas. Symmetric across all numeric metrics. */
export function diffReports(a: EvalReport, b: EvalReport): EvalDiff {
  return {
    passRateDelta: b.passRate - a.passRate,
    p50MsDelta: b.p50Ms - a.p50Ms,
    p95MsDelta: b.p95Ms - a.p95Ms,
    meanTokensInDelta: b.meanTokensIn - a.meanTokensIn,
    meanTokensOutDelta: b.meanTokensOut - a.meanTokensOut,
    meanCacheReadDelta: b.meanCacheRead - a.meanCacheRead,
    meanCacheWriteDelta: b.meanCacheWrite - a.meanCacheWrite,
    cacheHitRatioDelta: b.cacheHitRatio - a.cacheHitRatio,
    totalCostUsdDelta: b.totalCostUsd - a.totalCostUsd,
    meanCostUsdDelta: b.meanCostUsd - a.meanCostUsd,
    costPerSuccessUsdDelta: safeDelta(b.costPerSuccessUsd, a.costPerSuccessUsd),
    meanToolCallsDelta: b.meanToolCalls - a.meanToolCalls,
    meanTurnsDelta: b.meanTurns - a.meanTurns,
  };
}

/** Pull out a percentile from a SORTED ascending array. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

function safeDelta(b: number, a: number): number {
  if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return -a;
  return b - a;
}
