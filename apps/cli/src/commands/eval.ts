import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { defineCommand } from "citty";

import type {
  Blueprint,
  BlueprintId,
  EnvironmentConfig,
  EnvironmentProvider,
  ResolvedRoleModel,
} from "@oddjob/core";
import {
  recordingWrapper,
  replayFromJsonl,
  runOnce,
  type ResolvedLLM,
  type RunOnceResult,
} from "@oddjob/agent";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import { LoggingSqliteProvider, StepSqliteProvider } from "@oddjob/logging-sqlite";
import { RunEventSqliteProvider, RunMessageSqliteProvider } from "@oddjob/state-sqlite";
import { ProcessEnvironmentProvider } from "@oddjob/plugin-env-process";

import {
  aggregateRunMetrics,
  diffReports,
  type EvalReport,
  type RunMetricRow,
} from "../lib/eval-aggregate.ts";
import { buildRuntime, shutdownRuntime } from "../lib/runtime.ts";
import { loadConfig } from "../lib/config.ts";

interface DatasetCase {
  id: string;
  prompt: string;
  fixtureDir: string;
  checkPath?: string;
  expectedPath?: string;
  rubricPath?: string;
  /**
   * Optional inline JSON Schema for the case's required structured output.
   * Set on the synthesized blueprint as `outputSchema` so the loop's
   * `tryParseJson` extracts a fenced ```json``` block from the final
   * assistant message into `result.output.structuredOutput`. Pass-rate
   * scoring (check.ts) then reads the structured output from
   * `<sandboxDir>/.eval-output.json`.
   */
  outputSchema?: Record<string, unknown>;
}

export default defineCommand({
  meta: { name: "eval", description: "Run an eval dataset against the agent loop." },
  args: {
    dataset: {
      type: "positional",
      required: true,
      description: "Path to evals/<profile> dir or its dataset.jsonl",
    },
    limit: { type: "string", description: "Max cases (default: all)" },
    concurrency: { type: "string", description: "Parallel runs (default: 1)" },
    baseline: { type: "string", description: "Prior run report.json path to diff against" },
    replay: { type: "string", description: "Fixtures dir for replay-from-fixture (token-free)" },
    record: { type: "string", description: "Fixtures dir to write fixtures into during run" },
    report: { type: "string", default: "json", description: "json | md" },
    out: { type: "string", description: "Output dir (default: evals/.runs/<dataset>-<ts>/)" },
  },
  async run({ args }) {
    const datasetPath = await resolveDatasetPath(args.dataset);
    const datasetDir = dirname(datasetPath);
    const datasetName = basename(datasetDir);
    const limit = parseIntArg(args.limit);
    const concurrency = Math.max(1, parseIntArg(args.concurrency) ?? 1);
    const reportFormat = args.report === "md" ? "md" : "json";
    if (args.replay && args.record) {
      throw new Error("--replay and --record are mutually exclusive");
    }

    const cases = await loadDataset(datasetPath, datasetDir);
    const selected = limit !== undefined ? cases.slice(0, limit) : cases;

    // Output dir + per-eval sqlite. Don't pollute ~/.oddjob/oddjob.db.
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const outDir = args.out
      ? resolve(process.cwd(), args.out)
      : resolve(process.cwd(), `evals/.runs/${datasetName}-${ts}`);
    await mkdir(outDir, { recursive: true });
    const dbPath = join(outDir, "eval.db");
    const log = new LoggingSqliteProvider({ path: dbPath });
    const step = new StepSqliteProvider({ path: dbPath });
    // Run-message log so eval-runs that exercise compaction (B1.3) populate
    // run_messages alongside the live transcript. Required for review R-002
    // wiring to actually fire on `oddjob eval` invocations.
    const messages = new RunMessageSqliteProvider({ path: dbPath });
    // Run-event log so script-mode eval cases populate run_events for
    // replay. (codex round-12 #2)
    const runEvents = new RunEventSqliteProvider({ path: dbPath });
    await Promise.all([
      log.connect(),
      step.connect(),
      messages.connect(),
      runEvents.connect(),
    ]);

    // Empty-cases short-circuit — emit a zero report without booting the
    // runtime or resolving a model. Lets `--limit 0` work as a smoke test.
    if (selected.length === 0) {
      const report = aggregateRunMetrics([]);
      await writeReport(outDir, report, reportFormat, args.baseline);
      process.stdout.write(`eval: 0 cases — wrote zero report to ${outDir}\n`);
      await Promise.all([
        log.disconnect(),
        step.disconnect(),
        messages.disconnect(),
        runEvents.disconnect(),
      ]);
      return;
    }

    // Resolve a model unless replay short-circuits the LLM. Replay still wants
    // a model object for AgentLoopConfig — stub one. Record + live runs both
    // need a real model.
    let llm: ResolvedLLM;
    let runtimeShutdown: (() => Promise<void>) | undefined;
    if (!args.replay) {
      const cfg = await loadConfig();
      const rt = await buildRuntime(cfg);
      runtimeShutdown = () => shutdownRuntime(rt);
      let resolved: ResolvedRoleModel;
      try {
        resolved = await rt.roleResolver.resolve("default", undefined, undefined, undefined);
      } catch (err) {
        await runtimeShutdown();
        throw new Error(
          `eval: failed to resolve "default" role from config — set [roles.default] in ~/.oddjob/config.toml or use --replay. (${(err as Error).message})`,
          { cause: err },
        );
      }
      llm = { model: resolved.model, apiKey: resolved.apiKey };
    } else {
      llm = await stubLlmForReplay();
    }

    process.stdout.write(
      `eval: ${selected.length} cases (concurrency=${concurrency}) → ${outDir}\n`,
    );

    const sandbox: EnvironmentProvider = new ProcessEnvironmentProvider();
    const recordDir = args.record ? resolve(process.cwd(), args.record) : undefined;
    const replayDir = args.replay ? resolve(process.cwd(), args.replay) : undefined;
    if (recordDir) await mkdir(recordDir, { recursive: true });

    const rows: RunMetricRow[] = [];
    const queue = [...selected];
    const workers: Promise<void>[] = [];
    for (let i = 0; i < concurrency; i++) {
      workers.push(
        (async () => {
          while (true) {
            const c = queue.shift();
            if (!c) return;
            // Catch all per-case so one failure can't abort the whole eval
            // and leak the report. runOneCase already returns failedRow on
            // its known error paths; this is the safety net.
            let row: RunMetricRow;
            try {
              row = await runOneCase(c, {
                datasetDir,
                outDir,
                llm,
                sandbox,
                log,
                step,
                messages,
                runEvents,
                recordDir,
                replayDir,
              });
            } catch (err) {
              row = failedRow(
                c.id,
                Date.now(),
                `uncaught case error: ${(err as Error).message ?? String(err)}`,
              );
            }
            rows.push(row);
            process.stdout.write(
              `  [${row.passed ? "PASS" : "FAIL"}] ${row.caseId} ${row.durationMs}ms $${row.costUsd.toFixed(4)}\n`,
            );
          }
        })(),
      );
    }
    try {
      await Promise.all(workers);
    } finally {
      // Always write whatever rows we managed to collect + tear down — a
      // partial report beats a silent abort.
      rows.sort((a, b) => a.caseId.localeCompare(b.caseId));
      const report = aggregateRunMetrics(rows);
      await writeReport(outDir, report, reportFormat, args.baseline);

      process.stdout.write(
        `\neval: ${report.passed}/${report.cases} passed (${(report.passRate * 100).toFixed(1)}%) ` +
          `mean=$${report.meanCostUsd.toFixed(4)} total=$${report.totalCostUsd.toFixed(4)}\n`,
      );

      await Promise.all([
        log.disconnect(),
        step.disconnect(),
        messages.disconnect(),
        runEvents.disconnect(),
      ]);
      if (runtimeShutdown) await runtimeShutdown();
    }
  },
});

interface RunCtx {
  datasetDir: string;
  outDir: string;
  llm: ResolvedLLM;
  sandbox: EnvironmentProvider;
  log: LoggingSqliteProvider;
  step: StepSqliteProvider;
  messages: RunMessageSqliteProvider;
  runEvents: RunEventSqliteProvider;
  recordDir?: string;
  replayDir?: string;
}

async function runOneCase(c: DatasetCase, ctx: RunCtx): Promise<RunMetricRow> {
  const startedAt = Date.now();

  // Eval isolation: copy fixture/ into a fresh tempdir; check.ts /
  // expected.json / rubric.md / dataset.jsonl / harness code are NOT under
  // this dir, so the agent cannot see them.
  const sandboxDir = await mkdtemp(join(tmpdir(), `oddjob-eval-${c.id}-`));
  // Cleanup-on-exit: the process provider intentionally does not delete
  // caller-supplied workdirs. Without this every case leaks /tmp/oddjob-eval-*.
  // Set ODDJOB_EVAL_KEEP_SANDBOX=1 to preserve dirs for debugging.
  const keepSandbox = process.env.ODDJOB_EVAL_KEEP_SANDBOX === "1";
  try {
    try {
      await cp(c.fixtureDir, sandboxDir, { recursive: true });
    } catch (err) {
      return failedRow(c.id, startedAt, `fixture copy failed: ${(err as Error).message}`);
    }

    // Synthetic blueprint. Tools list mirrors the seven coding-shell tools the
    // plan calls out. Outcomes injects a verdict instruction so the agent can
    // mark success/error explicitly when programmatic check.ts doesn't apply.
    let rubricBody: string | undefined;
    if (c.rubricPath) {
      try {
        rubricBody = await readFile(c.rubricPath, "utf8");
      } catch (err) {
        return failedRow(c.id, startedAt, `rubric load failed: ${(err as Error).message}`);
      }
    }
    const bp = synthesizeBlueprint({
      caseId: c.id,
      prompt: c.prompt,
      rubricBody,
      outputSchema: c.outputSchema,
    });

    // Replay/record stream wrappers. Per-case fixture file so cases compose.
    let streamFn: StreamFn | undefined;
    if (ctx.replayDir) {
      streamFn = replayFromJsonl(join(ctx.replayDir, `${c.id}.jsonl`));
    } else if (ctx.recordDir) {
      // Lazy-import to avoid pulling pi-ai stream into the no-record path.
      const { streamSimple } = await import("@mariozechner/pi-ai");
      streamFn = recordingWrapper(streamSimple, join(ctx.recordDir, `${c.id}.jsonl`));
    }

    const envConfig: EnvironmentConfig = {
      type: "local",
      workingDir: sandboxDir,
      networking: { type: "unrestricted" },
    };

    let result: RunOnceResult;
    try {
      result = await runOnce({
        blueprint: bp,
        llm: ctx.llm,
        environment: { provider: ctx.sandbox, config: envConfig },
        log: ctx.log,
        step: ctx.step,
        messages: ctx.messages,
        runEvents: ctx.runEvents,
        input: c.prompt,
        streamFn,
      });
    } catch (err) {
      return failedRow(c.id, startedAt, `runOnce threw: ${(err as Error).message}`);
    }

    // Make the agent's structured output available to check.ts at a known
    // path inside the sandbox. Profile check.ts files that need to compare
    // against `expected.json` read this file; coding fixtures that just run
    // `bun test` ignore it.
    if (result.output.structuredOutput !== undefined) {
      try {
        await writeFile(
          join(sandboxDir, ".eval-output.json"),
          JSON.stringify(result.output.structuredOutput, null, 2),
        );
      } catch {
        /* swallow — check.ts may not need it */
      }
    }
    // Also export the agent's final assistant text so check.ts files for
    // text-output cases (web-research extraction, prose answers) can grep
    // it directly. The grader path can't see filesystem state; this gives
    // programmatic checks visibility into the model's actual answer.
    if (result.output.finalText) {
      try {
        await writeFile(join(sandboxDir, ".eval-output.txt"), result.output.finalText);
      } catch {
        /* swallow */
      }
    }

    // Pass-rate scoring. check.ts (programmatic) takes precedence. rubric is
    // graded inline by runGrader (when outcomes.grader was set), in which case
    // we read the verdict directly. Cases with neither = error.
    let passed: boolean;
    if (c.checkPath) {
      passed = await runProgrammaticCheck(c.checkPath, sandboxDir);
    } else if (rubricBody) {
      passed = result.verdict?.outcome === "success";
    } else {
      return failedRow(c.id, startedAt, `case ${c.id} has neither check.ts nor rubric.md`);
    }

    // Derive per-tool counts + cache totals from step rows. Cheaper than
    // walking events; the StepSqliteProvider already has them indexed by run.
    const stepRows = await ctx.step.getSteps(result.run.id);
    const perToolCalls: Record<string, number> = {};
    const perToolErrors: Record<string, number> = {};
    let cacheRead = 0;
    let cacheWrite = 0;
    let turns = 0;
    let toolErrors = 0;
    for (const s of stepRows) {
      if (s.kind === "tool_call" && s.endedAt !== undefined) {
        const name = s.toolName ?? "(unknown)";
        perToolCalls[name] = (perToolCalls[name] ?? 0) + 1;
        if (s.error) {
          perToolErrors[name] = (perToolErrors[name] ?? 0) + 1;
          toolErrors++;
        }
      } else if (s.kind === "llm_call" && s.endedAt !== undefined) {
        turns++;
        cacheRead += s.cacheRead ?? 0;
        cacheWrite += s.cacheWrite ?? 0;
      }
    }

    const finishedAt = Date.now();
    return {
      caseId: c.id,
      passed,
      durationMs: finishedAt - startedAt,
      tokensIn: result.run.tokenInput,
      tokensOut: result.run.tokenOutput,
      cacheRead,
      cacheWrite,
      costUsd: result.run.costUsd ?? 0,
      toolCalls: result.run.toolCalls,
      toolErrors,
      turns,
      perToolCalls,
      perToolErrors,
    };
  } finally {
    if (!keepSandbox) {
      await rm(sandboxDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function failedRow(caseId: string, startedAt: number, reason: string): RunMetricRow {
  process.stderr.write(`  [FAIL] ${caseId}: ${reason}\n`);
  return {
    caseId,
    passed: false,
    durationMs: Date.now() - startedAt,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    costUsd: 0,
    toolCalls: 0,
    toolErrors: 0,
    turns: 0,
  };
}

async function runProgrammaticCheck(checkPath: string, fixtureDir: string): Promise<boolean> {
  const proc = Bun.spawn({
    cmd: ["bun", checkPath, fixtureDir],
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  return exit === 0;
}

interface SynthesizeArgs {
  caseId: string;
  prompt: string;
  rubricBody?: string;
  outputSchema?: Record<string, unknown>;
}

function synthesizeBlueprint(args: SynthesizeArgs): Blueprint {
  const id: BlueprintId = `evals/${args.caseId}` as BlueprintId;
  return {
    id,
    name: args.caseId,
    namespace: "evals",
    version: "0.0.0",
    schemaVersion: 1,
    description: `Synthetic eval blueprint for ${args.caseId}`,
    author: "oddjob-eval",
    tags: ["eval"],
    license: "MIT",
    prompt: args.prompt,
    tools: [
      "bash",
      "read",
      "write",
      "edit",
      "grep",
      "find",
      "ls",
      // notes_append + notes_read survive compaction by reference; some
      // long-horizon eval cases require explicit use to validate B1.5.
      "notes_append",
      "notes_read",
    ],
    skills: [],
    connectors: {},
    scripts: {},
    memory: { store: "kv", retention: "0" },
    secrets: {},
    failOnToolError: false,
    // Only attach outcomes/grader when a rubric is set. For programmatic-check
    // cases the verdict comes from check.ts on either:
    //   - structured output (outputSchema set; agent emits fenced JSON, harness extracts)
    //   - file-system state (e.g. coding cases that run `bun test`)
    // Attaching `report_status` would shortcut the agent past JSON emission —
    // the agent calls report_status, the loop ends, no fenced JSON appears.
    ...(args.rubricBody
      ? {
          outcomes: {
            success: "Final answer satisfies the rubric.",
            error: "Final answer fails the rubric criteria.",
            warningTools: [],
            errorTools: [],
            maxRetries: 0,
            retryBackoffMs: 0,
            grader: {
              rubricLoaded: args.rubricBody,
              maxIterations: 1,
              onVerdict: "fail-only" as const,
            },
          },
        }
      : {}),
    ...(args.outputSchema
      ? { outputSchema: { type: "json-schema" as const, schema: args.outputSchema } }
      : {}),
    // path is consumed by runOnce only for blueprintDir derivation. Tools use
    // session.sessionWorkdir, so this string is decorative.
    path: `/eval/${args.caseId}/synthetic.toml`,
    contentHash: "synthetic",
  };
}

async function loadDataset(datasetPath: string, datasetDir: string): Promise<DatasetCase[]> {
  const raw = await readFile(datasetPath, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  return lines.map((line, i) => {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`dataset.jsonl line ${i + 1}: malformed JSON — ${(err as Error).message}`, {
        cause: err,
      });
    }
    const id = String(entry.id ?? `case-${i + 1}`);
    const prompt = typeof entry.prompt === "string" ? entry.prompt : "";
    if (!prompt) throw new Error(`dataset.jsonl line ${i + 1}: missing prompt`);
    const fixtureRel = entry.fixture_dir;
    if (typeof fixtureRel !== "string") {
      throw new Error(`dataset.jsonl line ${i + 1}: missing fixture_dir`);
    }
    const fixtureDir = resolveCasePath(datasetDir, fixtureRel);
    const out: DatasetCase = { id, prompt, fixtureDir };
    if (typeof entry.check === "string") out.checkPath = resolveCasePath(datasetDir, entry.check);
    if (typeof entry.expected === "string") {
      out.expectedPath = resolveCasePath(datasetDir, entry.expected);
    }
    if (typeof entry.rubric === "string") {
      out.rubricPath = resolveCasePath(datasetDir, entry.rubric);
    }
    if (entry.output_schema && typeof entry.output_schema === "object") {
      out.outputSchema = entry.output_schema as Record<string, unknown>;
    }
    if (!out.checkPath && !out.rubricPath) {
      throw new Error(
        `dataset.jsonl line ${i + 1}: case ${id} has neither "check" nor "rubric" — fail-loud per Phase A.3`,
      );
    }
    return out;
  });
}

function resolveCasePath(datasetDir: string, ref: string): string {
  return isAbsolute(ref) ? ref : resolve(datasetDir, ref);
}

async function resolveDatasetPath(input: string): Promise<string> {
  const abs = resolve(process.cwd(), input);
  const s = await stat(abs).catch(() => undefined);
  if (!s) throw new Error(`dataset path not found: ${abs}`);
  if (s.isFile()) return abs;
  const candidate = join(abs, "dataset.jsonl");
  const cs = await stat(candidate).catch(() => undefined);
  if (!cs?.isFile()) {
    throw new Error(`dataset path ${input} has no dataset.jsonl`);
  }
  return candidate;
}

function parseIntArg(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`expected non-negative integer, got ${JSON.stringify(v)}`);
  }
  return n;
}

async function writeReport(
  outDir: string,
  report: EvalReport,
  format: "json" | "md",
  baselinePath?: string,
): Promise<void> {
  const baseline = baselinePath ? await loadBaselineReport(baselinePath) : undefined;
  const diff = baseline ? diffReports(baseline, report) : undefined;
  const jsonPath = join(outDir, "report.json");
  await writeFile(
    jsonPath,
    JSON.stringify({ report, baseline: baseline ?? null, diff: diff ?? null }, null, 2),
    "utf8",
  );
  if (format === "md") {
    const mdPath = join(outDir, "report.md");
    await writeFile(mdPath, renderMarkdown(report, diff), "utf8");
    process.stdout.write(`report: ${mdPath}\n`);
  } else {
    process.stdout.write(`report: ${jsonPath}\n`);
  }
}

async function loadBaselineReport(path: string): Promise<EvalReport | undefined> {
  const abs = resolve(process.cwd(), path);
  let raw: string;
  try {
    raw = await readFile(abs, "utf8");
  } catch {
    process.stderr.write(`baseline ${abs} not readable — skipping diff\n`);
    return undefined;
  }
  const parsed = JSON.parse(raw) as { report?: EvalReport } | EvalReport;
  if ("report" in parsed && parsed.report) return parsed.report;
  if ("cases" in parsed) return parsed as EvalReport;
  return undefined;
}

function renderMarkdown(report: EvalReport, diff?: ReturnType<typeof diffReports>): string {
  const lines: string[] = [];
  lines.push(`# Eval report`);
  lines.push("");
  lines.push(`- cases: **${report.cases}**`);
  lines.push(
    `- pass-rate: **${(report.passRate * 100).toFixed(1)}%** (${report.passed}/${report.cases})`,
  );
  lines.push(`- p50/p95 wall-clock: ${report.p50Ms}ms / ${report.p95Ms}ms`);
  lines.push(
    `- mean tokens in/out: ${report.meanTokensIn.toFixed(0)} / ${report.meanTokensOut.toFixed(0)}`,
  );
  lines.push(`- cache-hit ratio: ${(report.cacheHitRatio * 100).toFixed(1)}%`);
  lines.push(
    `- total cost: $${report.totalCostUsd.toFixed(4)} (mean $${report.meanCostUsd.toFixed(4)})`,
  );
  lines.push(
    `- $/success: ${Number.isFinite(report.costPerSuccessUsd) ? `$${report.costPerSuccessUsd.toFixed(4)}` : "n/a (no passes)"}`,
  );
  lines.push(`- mean tool-calls: ${report.meanToolCalls.toFixed(2)}`);
  lines.push(`- mean turns: ${report.meanTurns.toFixed(2)}`);
  if (Object.keys(report.perToolErrorRate).length > 0) {
    lines.push("");
    lines.push("## Per-tool error rate");
    for (const [tool, rate] of Object.entries(report.perToolErrorRate)) {
      lines.push(`- ${tool}: ${(rate * 100).toFixed(1)}%`);
    }
  }
  if (diff) {
    lines.push("");
    lines.push("## Δ vs baseline");
    lines.push(`- pass-rate Δ: ${(diff.passRateDelta * 100).toFixed(1)}pp`);
    lines.push(`- p50 Δ: ${diff.p50MsDelta}ms · p95 Δ: ${diff.p95MsDelta}ms`);
    lines.push(
      `- cost Δ total: $${diff.totalCostUsdDelta.toFixed(4)} · mean: $${diff.meanCostUsdDelta.toFixed(4)}`,
    );
    lines.push(`- cache-hit Δ: ${(diff.cacheHitRatioDelta * 100).toFixed(1)}pp`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * In replay mode the LLM stream is fully scripted; we still need a `Model`
 * object to satisfy AgentLoopConfig. Use a faux registration so the type
 * checks line up — the streamFn intercepts before any real call.
 */
async function stubLlmForReplay(): Promise<ResolvedLLM> {
  const { registerFauxProvider } = await import("@mariozechner/pi-ai");
  const reg = registerFauxProvider({ models: [{ id: "eval-replay" }] });
  return { model: reg.getModel() };
}
