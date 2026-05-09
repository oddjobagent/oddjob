import { describe, expect, test } from "bun:test";

import { aggregateRunMetrics, diffReports, type RunMetricRow } from "./eval-aggregate.ts";

const row = (over: Partial<RunMetricRow> & Pick<RunMetricRow, "caseId">): RunMetricRow => ({
  passed: true,
  durationMs: 0,
  tokensIn: 0,
  tokensOut: 0,
  cacheRead: 0,
  cacheWrite: 0,
  costUsd: 0,
  toolCalls: 0,
  toolErrors: 0,
  turns: 0,
  ...over,
});

describe("aggregateRunMetrics", () => {
  test("empty input is a zero report — no NaN or Infinity except costPerSuccess", () => {
    const r = aggregateRunMetrics([], 1234);
    expect(r.cases).toBe(0);
    expect(r.passed).toBe(0);
    expect(r.passRate).toBe(0);
    expect(r.p50Ms).toBe(0);
    expect(r.p95Ms).toBe(0);
    expect(r.meanTokensIn).toBe(0);
    expect(r.cacheHitRatio).toBe(0);
    expect(r.totalCostUsd).toBe(0);
    expect(r.meanCostUsd).toBe(0);
    expect(r.costPerSuccessUsd).toBe(0);
    expect(Number.isNaN(r.passRate)).toBe(false);
    expect(Number.isNaN(r.p50Ms)).toBe(false);
    expect(r.generatedAt).toBe(1234);
  });

  test("4 cases, 3 pass / 1 fail — pass-rate 0.75, sane p50/p95", () => {
    const rows = [
      row({ caseId: "a", passed: true, durationMs: 100, costUsd: 0.1 }),
      row({ caseId: "b", passed: true, durationMs: 200, costUsd: 0.2 }),
      row({ caseId: "c", passed: false, durationMs: 300, costUsd: 0.3 }),
      row({ caseId: "d", passed: true, durationMs: 400, costUsd: 0.4 }),
    ];
    const r = aggregateRunMetrics(rows);
    expect(r.cases).toBe(4);
    expect(r.passed).toBe(3);
    expect(r.passRate).toBe(0.75);
    expect(r.p50Ms).toBe(200);
    expect(r.p95Ms).toBe(400);
    expect(r.totalCostUsd).toBeCloseTo(1.0, 6);
    expect(r.meanCostUsd).toBeCloseTo(0.25, 6);
    expect(r.costPerSuccessUsd).toBeCloseTo(1.0 / 3, 6);
  });

  test("cacheHitRatio = cacheRead / (cacheRead + tokensIn)", () => {
    const rows = [
      row({ caseId: "a", tokensIn: 100, cacheRead: 300 }),
      row({ caseId: "b", tokensIn: 100, cacheRead: 100 }),
    ];
    const r = aggregateRunMetrics(rows);
    expect(r.cacheHitRatio).toBeCloseTo(400 / (400 + 200), 6);
  });

  test("per-tool error rate aggregates calls + errors per tool", () => {
    const rows = [
      row({
        caseId: "a",
        perToolCalls: { bash: 4, read: 2 },
        perToolErrors: { bash: 1 },
      }),
      row({
        caseId: "b",
        perToolCalls: { bash: 6, read: 3 },
        perToolErrors: { bash: 2, read: 1 },
      }),
    ];
    const r = aggregateRunMetrics(rows);
    expect(r.perToolErrorRate.bash).toBeCloseTo(3 / 10, 6);
    expect(r.perToolErrorRate.read).toBeCloseTo(1 / 5, 6);
  });

  test("zero passes -> costPerSuccess Infinity, no NaN elsewhere", () => {
    const rows = [row({ caseId: "a", passed: false, costUsd: 0.5, durationMs: 50 })];
    const r = aggregateRunMetrics(rows);
    expect(r.passRate).toBe(0);
    expect(r.costPerSuccessUsd).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isFinite(r.meanCostUsd)).toBe(true);
  });
});

describe("diffReports", () => {
  test("delta sign + magnitude is symmetric across metrics", () => {
    const baseline = aggregateRunMetrics([
      row({ caseId: "a", passed: true, durationMs: 100, tokensIn: 100, costUsd: 1 }),
      row({ caseId: "b", passed: false, durationMs: 200, tokensIn: 200, costUsd: 2 }),
    ]);
    const next = aggregateRunMetrics([
      row({ caseId: "a", passed: true, durationMs: 80, tokensIn: 60, costUsd: 0.5 }),
      row({ caseId: "b", passed: true, durationMs: 150, tokensIn: 100, costUsd: 1 }),
    ]);
    const d = diffReports(baseline, next);
    expect(d.passRateDelta).toBeCloseTo(0.5, 6); // 0.5 -> 1.0
    expect(d.p50MsDelta).toBeLessThan(0); // faster
    expect(d.meanTokensInDelta).toBeLessThan(0); // fewer tokens
    expect(d.totalCostUsdDelta).toBeCloseTo(1.5 - 3, 6);
    expect(d.meanCostUsdDelta).toBeCloseTo(0.75 - 1.5, 6);
    expect(Number.isFinite(d.costPerSuccessUsdDelta)).toBe(true);
  });

  test("Infinity costPerSuccess (zero passes) collapses to finite delta", () => {
    const noneBaseline = aggregateRunMetrics([row({ caseId: "a", passed: false, costUsd: 1 })]);
    const onePassNext = aggregateRunMetrics([row({ caseId: "a", passed: true, costUsd: 1 })]);
    const d = diffReports(noneBaseline, onePassNext);
    expect(Number.isFinite(d.costPerSuccessUsdDelta)).toBe(true);
    // baseline=Infinity, next=1 -> delta=1 by safeDelta convention
    expect(d.costPerSuccessUsdDelta).toBe(1);
  });
});
