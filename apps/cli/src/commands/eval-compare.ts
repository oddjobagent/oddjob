// `oddjob eval-compare` — runs the same dataset through multiple
// routing strategies back-to-back and prints a side-by-side report.
//
// Phase 2 of agent_core_eval — picks the winning strategy per dataset
// by lowest mean $/success at no pass-rate regression.
//
// Today this just shells out to `oddjob eval` once per strategy and
// aggregates the resulting report.json files. We keep it as a separate
// command (vs. multiplexing inside `eval`) so the per-strategy reports
// remain individually inspectable.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "eval-compare",
    description:
      "Run a dataset through multiple routing strategies back-to-back; print side-by-side metrics.",
  },
  args: {
    dataset: {
      type: "positional",
      required: true,
      description: "Path to evals/<profile> dir or its dataset.jsonl",
    },
    strategies: {
      type: "string",
      default: "fixed,classifier",
      description: "Comma-separated strategy list (subset of: fixed, classifier)",
    },
    "tier-simple": {
      type: "string",
      description: "classifier strategy: model id for 'simple' label",
    },
    "tier-standard": {
      type: "string",
      description: "classifier strategy: model id for 'standard' label",
    },
    "tier-complex": {
      type: "string",
      description: "classifier strategy: model id for 'complex' label",
    },
    "classifier-model": {
      type: "string",
      description: "classifier strategy: model id for the classifier itself",
    },
    limit: { type: "string", description: "Max cases per strategy run (default: all)" },
    concurrency: { type: "string", description: "Parallel runs per strategy (default: 1)" },
    out: {
      type: "string",
      description: "Output dir for combined report (default: evals/.runs/compare-<ts>/)",
    },
  },
  async run({ args }) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const outRoot = args.out
      ? resolve(process.cwd(), args.out)
      : resolve(process.cwd(), `evals/.runs/compare-${ts}`);
    await mkdir(outRoot, { recursive: true });

    const strategies = args.strategies.split(",").map((s) => s.trim()).filter(Boolean);
    if (strategies.length < 2) {
      throw new Error("eval-compare needs at least 2 strategies (got: " + strategies.join(",") + ")");
    }
    const valid = new Set(["fixed", "classifier"]);
    for (const s of strategies) {
      if (!valid.has(s)) {
        throw new Error(`unknown strategy '${s}'; valid: fixed | classifier`);
      }
    }

    const results: { strategy: string; reportPath: string; report: ComparedReport }[] = [];
    for (const strategy of strategies) {
      const strategyOut = resolve(outRoot, strategy);
      process.stdout.write(`\n== eval-compare: strategy=${strategy} ==\n`);
      const childArgs = [
        "apps/cli/src/index.ts",
        "eval",
        args.dataset,
        "--strategy",
        strategy,
        "--out",
        strategyOut,
      ];
      if (args.limit) childArgs.push("--limit", args.limit);
      if (args.concurrency) childArgs.push("--concurrency", args.concurrency);
      if (strategy === "classifier") {
        if (args["tier-simple"]) childArgs.push("--tier-simple", args["tier-simple"]);
        if (args["tier-standard"]) childArgs.push("--tier-standard", args["tier-standard"]);
        if (args["tier-complex"]) childArgs.push("--tier-complex", args["tier-complex"]);
        if (args["classifier-model"]) childArgs.push("--classifier-model", args["classifier-model"]);
      }
      const proc = Bun.spawn(["bun", ...childArgs], {
        stdout: "inherit",
        stderr: "inherit",
        env: process.env,
      });
      const code = await proc.exited;
      if (code !== 0) {
        throw new Error(`eval (strategy=${strategy}) exited ${code}; aborting comparison`);
      }
      const reportPath = resolve(strategyOut, "report.json");
      const text = await readFile(reportPath, "utf8");
      // The eval CLI writes `{ report: {...}, baselineDiff: ... }`. Unwrap.
      const parsed = JSON.parse(text) as { report: ComparedReport };
      const report = parsed.report;
      results.push({ strategy, reportPath, report });
    }

    // Print side-by-side table.
    const table = renderTable(results);
    process.stdout.write(`\n${table}\n`);

    // Persist combined report.
    const combined = {
      dataset: args.dataset,
      strategies: results.map((r) => ({
        strategy: r.strategy,
        reportPath: r.reportPath,
        cases: r.report.cases,
        passed: r.report.passed,
        passRate: r.report.passRate,
        meanCostUsd: r.report.meanCostUsd,
        totalCostUsd: r.report.totalCostUsd,
        costPerSuccessUsd: r.report.costPerSuccessUsd,
        p50Ms: r.report.p50Ms,
        p95Ms: r.report.p95Ms,
      })),
    };
    const combinedPath = resolve(outRoot, "compare.json");
    await writeFile(combinedPath, `${JSON.stringify(combined, null, 2)}\n`);
    process.stdout.write(`\ncombined report: ${combinedPath}\n`);

    // Pick a winner: lowest $/success at no pass-rate regression vs the
    // first strategy.
    if (results.length >= 2) {
      const baseline = results[0]!;
      const baselinePass = baseline.report.passRate;
      const baselineCps =
        baseline.report.passed > 0 ? baseline.report.costPerSuccessUsd : Infinity;
      let winner = baseline;
      let winnerCps = baselineCps;
      for (const r of results.slice(1)) {
        const cps = r.report.passed > 0 ? r.report.costPerSuccessUsd : Infinity;
        if (r.report.passRate >= baselinePass && cps < winnerCps) {
          winner = r;
          winnerCps = cps;
        }
      }
      process.stdout.write(
        `\nwinner (lowest $/success at no pass-rate regression vs ${baseline.strategy}): ${winner.strategy} ` +
          `($${winnerCps.toFixed(4)}/success, pass=${(winner.report.passRate * 100).toFixed(1)}%)\n`,
      );
    }
  },
});

interface ComparedReport {
  cases: number;
  passed: number;
  passRate: number;
  meanCostUsd: number;
  totalCostUsd: number;
  costPerSuccessUsd: number;
  p50Ms: number;
  p95Ms: number;
}

function renderTable(rows: { strategy: string; report: ComparedReport }[]): string {
  const header = ["strategy", "pass", "rate", "$mean", "$total", "$/succ", "p50ms", "p95ms"];
  const cells: string[][] = [header];
  for (const r of rows) {
    cells.push([
      r.strategy,
      `${r.report.passed}/${r.report.cases}`,
      `${(r.report.passRate * 100).toFixed(1)}%`,
      `$${r.report.meanCostUsd.toFixed(4)}`,
      `$${r.report.totalCostUsd.toFixed(4)}`,
      r.report.passed > 0 ? `$${r.report.costPerSuccessUsd.toFixed(4)}` : "n/a",
      `${Math.round(r.report.p50Ms)}`,
      `${Math.round(r.report.p95Ms)}`,
    ]);
  }
  const widths = header.map((_, i) => Math.max(...cells.map((row) => row[i]!.length)));
  return cells
    .map((row) => row.map((v, i) => v.padEnd(widths[i]!)).join("  "))
    .join("\n");
}
