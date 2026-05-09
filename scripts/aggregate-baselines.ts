#!/usr/bin/env bun
// Aggregates per-profile eval reports into evals/baselines/v0.json (or vN
// when called with --version vN). Reads each profile's report.json from
// evals/.runs/v0-<profile>/ and writes a single combined baseline.
//
// Usage:
//   bun scripts/aggregate-baselines.ts [--version v0] [--out evals/baselines/v0.json]

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface ProfileReport {
  generatedAt: number;
  cases: number;
  passed: number;
  passRate: number;
  p50Ms: number;
  p95Ms: number;
  meanTokensIn: number;
  meanTokensOut: number;
  meanCacheRead: number;
  meanCacheWrite: number;
  cacheHitRatio: number;
  totalCostUsd: number;
  meanCostUsd: number;
  costPerSuccessUsd: number;
  meanToolCalls: number;
  meanTurns: number;
  perToolErrorRate: Record<string, number>;
  rows: unknown[];
}

interface ProfileWrap {
  report: ProfileReport;
}

const PROFILES = ["coding", "data-extract", "long-horizon", "web-research"] as const;

const args = process.argv.slice(2);
const versionIdx = args.indexOf("--version");
const version = versionIdx >= 0 ? (args[versionIdx + 1] ?? "v0") : "v0";
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? args[outIdx + 1] : `evals/baselines/${version}.json`;
if (!outPath) {
  console.error("--out required when not auto-derived");
  process.exit(2);
}

const profileReports: Record<string, ProfileReport> = {};
let aggregateCases = 0;
let aggregatePassed = 0;
let aggregateTotalCost = 0;

for (const p of PROFILES) {
  const path = resolve(`evals/.runs/${version}-${p}/report.json`);
  try {
    const wrap = JSON.parse(await readFile(path, "utf8")) as ProfileWrap;
    profileReports[p] = wrap.report;
    aggregateCases += wrap.report.cases;
    aggregatePassed += wrap.report.passed;
    aggregateTotalCost += wrap.report.totalCostUsd;
  } catch (err) {
    console.error(`profile ${p}: skipped (${(err as Error).message})`);
  }
}

const baseline = {
  version,
  generatedAt: Date.now(),
  aggregate: {
    cases: aggregateCases,
    passed: aggregatePassed,
    passRate: aggregateCases > 0 ? aggregatePassed / aggregateCases : 0,
    totalCostUsd: aggregateTotalCost,
    meanCostUsd: aggregateCases > 0 ? aggregateTotalCost / aggregateCases : 0,
  },
  profiles: profileReports,
};

await mkdir(resolve(outPath, ".."), { recursive: true });
await writeFile(outPath, JSON.stringify(baseline, null, 2));
console.log(
  `wrote ${outPath}: ${aggregateCases} cases / ${aggregatePassed} passed / $${aggregateTotalCost.toFixed(4)} total`,
);
