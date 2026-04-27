import { randomUUID } from "node:crypto";
import { dirname, isAbsolute } from "node:path";

import {
  type AgentEvent,
  type AgentLoopConfig,
  type AgentMessage,
  runAgentLoop,
} from "@mariozechner/pi-agent-core";
import { type AssistantMessage, type Message, streamSimple, type Usage } from "@mariozechner/pi-ai";

import type { LogEntry, LogProvider } from "../providers/logging.ts";
import type { AuthProvider } from "../providers/auth.ts";
import type { McpProvider } from "../providers/mcp.ts";
import type { SecretsProvider } from "../providers/secrets.ts";
import type { EnvironmentProvider, EnvironmentSession } from "../providers/environment.ts";
import type { Blueprint } from "../types/blueprint.ts";
import type { Limits } from "../types/limits.ts";
import type { Run, RunId } from "../types/run.ts";
import type { RunOutput } from "../types/output.ts";

import { buildBuiltinTools, isBuiltinToolName, type EngineConfig } from "./builtin-tools/index.ts";
import type { EngineLLM } from "../engine/engine-llm.ts";
import type { PluginRegistry } from "../plugin/registry.ts";
import { validateOutput } from "./output-validate.ts";
import { buildMcpRuntime } from "./mcp-tool.ts";
import {
  composeOutputSchemaWithChannels,
  type DynamicChannelDescriptor,
} from "./output-schema-compose.ts";
import { buildRevisionPrompt, type GraderEvaluation, runGrader } from "./grader.ts";
import { createReportStatusTool, type RunVerdict } from "./report-status-tool.ts";
import { buildSkillTool } from "./skill-tool.ts";
import { buildScriptTools } from "./script-tool.ts";
import { assembleSystemPrompt } from "./system-prompt.ts";
import { loadSkills, type LoadedSkill } from "../skills/index.ts";

export interface ResolvedLLM {
  model: import("@mariozechner/pi-ai").Model<import("@mariozechner/pi-ai").Api>;
  apiKey?: string;
}

export interface RunOnceOptions {
  blueprint: Blueprint;
  llm: ResolvedLLM;
  sandbox: EnvironmentProvider;
  log?: LogProvider;
  input?: unknown;
  runId?: RunId;
  deploymentId?: string;
  triggeredBy?: Run["triggeredBy"];
  limits?: Limits;
  signal?: AbortSignal;
  systemPromptExtra?: string;
  mcp?: McpProvider;
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  engine?: EngineConfig;
  /**
   * Channels with `mode = "dynamic"` from the deployment. When provided, the
   * harness composes their contracts into the effective output_schema and
   * exposes the contract block in the system prompt. The agent fills
   * `output.structured.channels.<name>` per channel.
   */
  dynamicChannels?: readonly DynamicChannelDescriptor[];
  /**
   * Optional grader LLM. Used when `blueprint.outcomes.grader` declares a
   * different `model` than the agent. When omitted, grader uses `llm`.
   */
  grader?: GraderOverride;
  /**
   * Optional plugin-system bridge. When supplied, the harness will use it to
   * resolve roles like "grader" and (in future) "advisor". Falls back to the
   * legacy `llm`/`grader` paths when omitted.
   */
  engineLlm?: EngineLLM;
  /**
   * Optional plugin registry. When supplied, tool names in `blueprint.tools`
   * that are NOT built-ins are looked up in the registry and built via
   * `service.build({ environment, blueprintDir, engine, onLog })`. Lets a
   * vibe-coded plugin contribute extra tools without touching core.
   */
  plugins?: PluginRegistry;
  /**
   * Optional confirmation gate. Fired before any tool whose name appears in
   * `blueprint.toolPolicies` with `confirm: true`. The harness pauses the
   * agent loop until this resolves; the resolution carries either an `allow`
   * verdict (tool fires normally) or `deny` (tool returns an error result).
   * The worker pool wires this to `POST /api/v1/runs/:id/confirm`.
   */
  onConfirmRequest?: (req: ConfirmRequest) => Promise<ConfirmResolution>;
}

export interface ConfirmRequest {
  runId: string;
  toolUseId: string;
  toolName: string;
  args: unknown;
}

export interface ConfirmResolution {
  allow: boolean;
  denyMessage?: string;
}

export interface RunOnceResult {
  run: Run;
  output: RunOutput;
  events: AgentEvent[];
  messages: AgentMessage[];
  verdict?: RunVerdict;
  /** Whether the run is retry-eligible (verdict.outcome === "warning"). */
  retriable: boolean;
  /** Per-iteration grader evaluations when [outcomes.grader] is set. */
  graderEvaluations?: GraderEvaluation[];
}

/**
 * Optional override: provide a different ResolvedLLM for the grader. When omitted,
 * the grader runs on the same model as the agent. The server wires this from
 * `blueprint.outcomes.grader.model` if present.
 */
export interface GraderOverride {
  llm: ResolvedLLM;
}

export async function runOnce(opts: RunOnceOptions): Promise<RunOnceResult> {
  const { blueprint, llm, sandbox, log, input, limits, signal, systemPromptExtra } = opts;
  const runId = opts.runId ?? randomUUID();
  const deploymentId = opts.deploymentId ?? `_local:${blueprint.id}`;
  const triggeredBy: Run["triggeredBy"] = opts.triggeredBy ?? "manual";
  const startedAt = Date.now();

  const blueprintDir = isAbsolute(blueprint.path) ? dirname(blueprint.path) : process.cwd();
  // Pass blueprintDir as workdir so the session's filesystem operations
  // resolve relative paths against the blueprint root. Process backend uses
  // this as its tempdir replacement; container/remote backends will mount or
  // upload it. Phase 15b reworks this when the resolved Environment lands.
  const session: EnvironmentSession = await sandbox.spawn({
    workdir: blueprintDir,
    timeoutMs: limits?.durationMs,
  });

  const events: AgentEvent[] = [];
  const append = (entry: LogEntry) => {
    if (log) void log.log(runId, entry);
  };

  let toolCalls = 0;
  let toolErrorCount = 0;
  let lastToolError: string | undefined;
  let lastToolErrorName: string | undefined;
  let verdict: RunVerdict | undefined;
  let usageTotal: Usage | undefined;
  let mcpRuntime: Awaited<ReturnType<typeof buildMcpRuntime>> | undefined;
  try {
    const skills: LoadedSkill[] = blueprint.skills.length > 0 ? loadSkills(blueprint) : [];
    const skillTool = buildSkillTool({ skills, onLog: append });
    const scriptTools = buildScriptTools({
      blueprint,
      environment: session,
      blueprintDir,
      onLog: append,
    });
    mcpRuntime = await buildMcpRuntime({
      blueprint,
      mcp: opts.mcp,
      secrets: opts.secrets,
      auth: opts.auth,
      deploymentId,
    });
    const builtinTools = buildBuiltinTools({
      allowlist: blueprint.tools,
      environment: session,
      blueprintDir,
      engine: opts.engine,
      onLog: append,
    });
    // Plugin-supplied tools: any name in the allowlist that isn't a builtin
    // and IS registered in the plugin registry.
    const pluginTools = (() => {
      if (!opts.plugins) return [];
      const out: ReturnType<typeof buildBuiltinTools> = [];
      for (const name of blueprint.tools) {
        if (isBuiltinToolName(name)) continue;
        const svc = opts.plugins.toolFor(name);
        if (!svc) continue;
        try {
          out.push(
            svc.build({
              environment: session,
              blueprintDir,
              engine: opts.engine,
              onLog: append,
            }) as (typeof out)[number],
          );
        } catch (err) {
          append({
            timestamp: Date.now(),
            level: "error",
            message: `plugin tool '${name}' failed to build: ${(err as Error).message}`,
          });
        }
      }
      return out;
    })();
    // Register report_status when [outcomes] is declared so the agent knows
    // the harness expects an authoritative verdict.
    const reportStatusTool = blueprint.outcomes
      ? createReportStatusTool({
          onVerdict: (v) => {
            verdict = v;
            append({
              timestamp: Date.now(),
              level: v.outcome === "success" ? "info" : v.outcome === "warning" ? "warn" : "error",
              message: `verdict: ${v.outcome} — ${v.reason}`,
            });
          },
        })
      : undefined;
    const tools = [
      ...builtinTools,
      ...pluginTools,
      ...scriptTools,
      ...mcpRuntime.tools,
      ...(skillTool ? [skillTool] : []),
      ...(reportStatusTool ? [reportStatusTool] : []),
    ];

    // When dynamic channels are present, compose their contracts into the
    // blueprint's effective outputSchema so the prompt + structured-output
    // extraction both see the augmented shape.
    const dynamicChannels = opts.dynamicChannels ?? [];
    const effectiveBlueprint =
      dynamicChannels.length > 0
        ? {
            ...blueprint,
            outputSchema: composeOutputSchemaWithChannels(blueprint.outputSchema, dynamicChannels),
          }
        : blueprint;
    const systemPrompt = assembleSystemPrompt({
      blueprint: effectiveBlueprint,
      skills,
      extra: systemPromptExtra,
      dynamicChannels,
    });
    const userPrompt: AgentMessage = {
      role: "user",
      content: typeof input === "string" ? input : JSON.stringify(input ?? {}),
      timestamp: Date.now(),
    };

    const config: AgentLoopConfig = {
      model: llm.model,
      convertToLlm: (messages: AgentMessage[]) => messages as Message[],
      apiKey: llm.apiKey,
      beforeToolCall: async (ctx) => {
        toolCalls++;
        append({
          timestamp: Date.now(),
          level: "info",
          message: `tool call ${ctx.toolCall.name}`,
          meta: { args: ctx.args, toolCalls },
        });
        if (limits?.toolCalls && toolCalls > limits.toolCalls) {
          append({
            timestamp: Date.now(),
            level: "warn",
            message: `tool call limit ${limits.toolCalls} exceeded (soft warning, run continues)`,
          });
        } else if (
          limits?.toolCalls &&
          limits.warnThresholdPct &&
          toolCalls === Math.ceil((limits.toolCalls * limits.warnThresholdPct) / 100)
        ) {
          append({
            timestamp: Date.now(),
            level: "warn",
            message: `tool calls reached ${limits.warnThresholdPct}% of limit (${toolCalls}/${limits.toolCalls})`,
          });
        }
        // Permission gate: pause for explicit allow/deny before firing.
        const policy = blueprint.toolPolicies?.[ctx.toolCall.name];
        if (policy?.confirm && opts.onConfirmRequest) {
          append({
            timestamp: Date.now(),
            level: "warn",
            message: `tool ${ctx.toolCall.name} awaiting confirmation`,
            meta: { toolUseId: ctx.toolCall.id },
          });
          const resolution = await opts.onConfirmRequest({
            runId,
            toolUseId: ctx.toolCall.id,
            toolName: ctx.toolCall.name,
            args: ctx.args,
          });
          append({
            timestamp: Date.now(),
            level: resolution.allow ? "info" : "warn",
            message: `tool ${ctx.toolCall.name} ${resolution.allow ? "approved" : "denied"}`,
            meta: { toolUseId: ctx.toolCall.id, denyMessage: resolution.denyMessage },
          });
          if (!resolution.allow) {
            return {
              block: true,
              reason: `denied by user${resolution.denyMessage ? `: ${resolution.denyMessage}` : ""}`,
            };
          }
        }
        return undefined;
      },
      afterToolCall: async (ctx) => {
        if (ctx.isError) {
          toolErrorCount++;
          lastToolErrorName = ctx.toolCall.name;
          lastToolError = `${ctx.toolCall.name}: ${extractErrorText(ctx.result)}`;
        }
        append({
          timestamp: Date.now(),
          level: ctx.isError ? "error" : "debug",
          message: `tool ${ctx.toolCall.name} done`,
          meta: { isError: ctx.isError },
        });
        return undefined;
      },
    };

    if (tools.length > 0) {
      (config as AgentLoopConfig & { tools?: unknown }).tools = tools;
    }

    const onEvent = (e: AgentEvent) => {
      events.push(e);
      if (e.type === "message_end" && e.message.role === "assistant") {
        const u = (e.message as AssistantMessage).usage;
        if (u) usageTotal = sumUsage(usageTotal, u);
      }
    };

    // Initial agent invocation. May iterate when [outcomes.grader] is set.
    let messages = await runAgentLoop(
      [userPrompt],
      { systemPrompt, messages: [], tools },
      config,
      onEvent,
      signal,
      streamSimple,
    );

    // Grader iteration loop. Only fires when blueprint.outcomes.grader is set
    // AND a rubric is available (rubricLoaded for file-backed, rubricText otherwise).
    const graderCfg = blueprint.outcomes?.grader;
    const rubricBody = graderCfg
      ? (graderCfg.rubricLoaded ?? graderCfg.rubricText ?? undefined)
      : undefined;
    const graderEvaluations: GraderEvaluation[] = [];
    if (graderCfg && rubricBody) {
      let graderLlm: ResolvedLLM = opts.grader?.llm ?? llm;
      if (opts.engineLlm && opts.engineLlm.hasRole("grader")) {
        try {
          const resolved = await opts.engineLlm.forRole("grader");
          graderLlm = { model: resolved.model, apiKey: resolved.apiKey };
        } catch {
          // Fall through to legacy override.
        }
      }
      const maxIter = graderCfg.maxIterations;
      for (let iter = 0; iter < maxIter; iter++) {
        const lastAssistant = lastAssistantMessage(messages);
        const artifact = artifactSnapshot(lastAssistant, effectiveBlueprint);
        const evaluation = await runGrader({
          blueprint,
          llm: graderLlm,
          rubric: rubricBody,
          artifact,
          iteration: iter,
          log,
          runId,
          signal,
        });
        graderEvaluations.push(evaluation);
        if (evaluation.usage) {
          usageTotal = sumUsage(usageTotal, {
            input: evaluation.usage.input,
            output: evaluation.usage.output,
            cost: evaluation.usage.cost
              ? { total: evaluation.usage.cost, input: 0, output: 0 }
              : undefined,
          } as Usage);
        }

        if (evaluation.result === "satisfied" || evaluation.result === "failed") break;
        if (iter === maxIter - 1) break; // grader said needs_revision but no budget left

        // Reset the per-iteration verdict so a stale "success" from the prior
        // round doesn't shadow the next round's report_status call.
        verdict = undefined;

        const revision: AgentMessage = {
          role: "user",
          content: buildRevisionPrompt(evaluation),
          timestamp: Date.now(),
        };
        append({
          timestamp: Date.now(),
          level: "info",
          message: `grader needs_revision; injecting feedback for iteration ${iter + 1}/${maxIter}`,
        });
        messages = await runAgentLoop(
          [revision],
          { systemPrompt, messages, tools },
          config,
          onEvent,
          signal,
          streamSimple,
        );
      }
    }

    const finalAssistant = lastAssistantMessage(messages);
    const output = extractOutput(finalAssistant, effectiveBlueprint);
    const outputValidation = validateOutput(blueprint, output.structuredOutput);
    if (!outputValidation.ok) {
      append({
        timestamp: Date.now(),
        level: "warn",
        message: `output failed schema validation: ${outputValidation.errors?.map((e) => `${e.path} ${e.message}`).join("; ") ?? "(unknown)"}`,
      });
    }

    // Apply final grader verdict if grader ran and is now decisive.
    const finalGrader = graderEvaluations[graderEvaluations.length - 1];
    if (finalGrader && graderCfg) {
      if (finalGrader.result === "satisfied") {
        verdict = { outcome: "success", reason: finalGrader.explanation };
      } else if (finalGrader.result === "failed") {
        verdict = { outcome: "error", reason: `grader: ${finalGrader.explanation}` };
      } else if (graderCfg.onVerdict !== "advisory") {
        // needs_revision after iterations exhausted -> warning (default) or error (fail-only)
        const outcome: RunVerdict["outcome"] =
          graderCfg.onVerdict === "fail-only" ? "error" : "warning";
        verdict = {
          outcome,
          reason: `grader: max_iterations (${graderCfg.maxIterations}) exhausted - ${finalGrader.explanation}`,
        };
      }
    }
    const finishedAt = Date.now();
    const cost = usageTotal?.cost?.total ?? 0;
    const tokenInput = usageTotal?.input ?? 0;
    const tokenOutput = usageTotal?.output ?? 0;

    if (limits?.budgetUsd && cost > limits.budgetUsd) {
      append({
        timestamp: finishedAt,
        level: "warn",
        message: `budget ${limits.budgetUsd} USD exceeded, actual ${cost.toFixed(4)} (soft warning)`,
      });
    } else if (
      limits?.budgetUsd &&
      limits.warnThresholdPct &&
      cost >= (limits.budgetUsd * limits.warnThresholdPct) / 100
    ) {
      append({
        timestamp: finishedAt,
        level: "warn",
        message: `budget at ${limits.warnThresholdPct}% (${cost.toFixed(4)}/${limits.budgetUsd} USD)`,
      });
    }

    const stoppedWithError = isErrorStop(finalAssistant?.stopReason);
    const classification = classifyRun({
      blueprint,
      verdict,
      stoppedWithError,
      toolErrorCount,
      lastToolErrorName,
      lastToolError,
      stopErrorMessage: finalAssistant?.errorMessage,
    });
    const status: Run["status"] = classification.failed ? "failed" : "complete";
    const error = classification.errorMessage;
    if (classification.failed) {
      append({
        timestamp: finishedAt,
        level: "error",
        message: `run failed: ${error}`,
        meta: { toolErrorCount, verdict: verdict?.outcome },
      });
    } else if (verdict) {
      append({
        timestamp: finishedAt,
        level: "info",
        message: `run complete: ${verdict.outcome}`,
      });
    }

    const run: Run = {
      id: runId,
      deploymentId,
      blueprintId: blueprint.id,
      blueprintVersion: blueprint.version,
      blueprintHash: blueprint.contentHash,
      triggeredBy,
      status,
      input,
      output,
      outputValidation,
      error,
      costUsd: cost,
      tokenInput,
      tokenOutput,
      toolCalls,
      startedAt,
      finishedAt,
      createdAt: startedAt,
    };

    return {
      run,
      output,
      events,
      messages,
      verdict,
      retriable: classification.retriable,
      graderEvaluations: graderEvaluations.length > 0 ? graderEvaluations : undefined,
    };
  } finally {
    await mcpRuntime?.close().catch(() => undefined);
    await session.kill();
  }
}

function isErrorStop(stop: string | undefined): boolean {
  return stop === "error" || stop === "aborted" || stop === "abort";
}

interface ClassifyArgs {
  blueprint: Blueprint;
  verdict: RunVerdict | undefined;
  stoppedWithError: boolean;
  toolErrorCount: number;
  lastToolErrorName: string | undefined;
  lastToolError: string | undefined;
  stopErrorMessage: string | undefined;
}

interface RunClassification {
  /** True when the run row should be marked status: "failed". */
  failed: boolean;
  /** True when the run is retry-eligible (warning verdict, attempts available). */
  retriable: boolean;
  /** Message stored on Run.error for display. */
  errorMessage: string | undefined;
}

function classifyRun(args: ClassifyArgs): RunClassification {
  const {
    blueprint,
    verdict,
    stoppedWithError,
    toolErrorCount,
    lastToolErrorName,
    lastToolError,
    stopErrorMessage,
  } = args;

  // Hardest signal first: the LLM itself errored / aborted.
  if (stoppedWithError) {
    return { failed: true, retriable: false, errorMessage: stopErrorMessage ?? "agent stop=error" };
  }

  // Authoritative verdict from report_status if the agent called it.
  if (verdict) {
    if (verdict.outcome === "success")
      return { failed: false, retriable: false, errorMessage: undefined };
    return {
      failed: true,
      retriable: verdict.outcome === "warning",
      errorMessage: `${verdict.outcome}: ${verdict.reason}`,
    };
  }

  // No verdict — fall through to declarative outcome rules on tool errors.
  const o = blueprint.outcomes;
  if (o && toolErrorCount > 0 && lastToolErrorName) {
    if (o.errorTools.includes(lastToolErrorName)) {
      return {
        failed: true,
        retriable: false,
        errorMessage: `tool error (no retry): ${lastToolError}`,
      };
    }
    if (o.warningTools.includes(lastToolErrorName)) {
      return {
        failed: true,
        retriable: true,
        errorMessage: `tool warning (retry-eligible): ${lastToolError}`,
      };
    }
  }

  // Legacy knob: blanket fail-on-any-tool-error (deprecated, default false).
  if (blueprint.failOnToolError && toolErrorCount > 0) {
    return {
      failed: true,
      retriable: false,
      errorMessage: `tool error (${toolErrorCount}): ${lastToolError}`,
    };
  }

  // Otherwise: graceful complete.
  return { failed: false, retriable: false, errorMessage: undefined };
}

function extractErrorText(
  result: { content?: Array<{ type: string; text?: string }> } | undefined,
): string {
  if (!result?.content) return "";
  for (const block of result.content) {
    if (block.type === "text" && typeof block.text === "string") {
      return block.text.length > 500 ? `${block.text.slice(0, 500)}…` : block.text;
    }
  }
  return "";
}

function sumUsage(prev: Usage | undefined, next: Usage): Usage {
  if (!prev) return next;
  return {
    ...next,
    input: prev.input + next.input,
    output: prev.output + next.output,
    cacheRead: (prev.cacheRead ?? 0) + (next.cacheRead ?? 0),
    cacheWrite: (prev.cacheWrite ?? 0) + (next.cacheWrite ?? 0),
    cost: {
      input: (prev.cost?.input ?? 0) + (next.cost?.input ?? 0),
      output: (prev.cost?.output ?? 0) + (next.cost?.output ?? 0),
      cacheRead: (prev.cost?.cacheRead ?? 0) + (next.cost?.cacheRead ?? 0),
      cacheWrite: (prev.cost?.cacheWrite ?? 0) + (next.cost?.cacheWrite ?? 0),
      total: (prev.cost?.total ?? 0) + (next.cost?.total ?? 0),
    },
  };
}

function lastAssistantMessage(messages: AgentMessage[]): AssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "assistant") return m as AssistantMessage;
  }
  return undefined;
}

function artifactSnapshot(msg: AssistantMessage | undefined, blueprint: Blueprint): string {
  const out = extractOutput(msg, blueprint);
  if (out.structuredOutput) {
    return [
      out.finalText,
      "",
      "### structured_output",
      "```json",
      JSON.stringify(out.structuredOutput, null, 2),
      "```",
    ].join("\n");
  }
  return out.finalText || "(empty artifact)";
}

function extractOutput(msg: AssistantMessage | undefined, blueprint: Blueprint): RunOutput {
  if (!msg) return { finalText: "" };
  const texts: string[] = [];
  for (const block of msg.content) {
    if (block.type === "text") texts.push(block.text);
  }
  const finalText = texts.join("\n").trim();
  let structured: Record<string, unknown> | undefined;
  if (blueprint.outputSchema && finalText) {
    structured = tryParseJson(finalText);
  }
  return { finalText, structuredOutput: structured };
}

function tryParseJson(s: string): Record<string, unknown> | undefined {
  const fenced = [...s.matchAll(/```(?:json)?\s*([\s\S]+?)```/g)];
  const candidates: string[] =
    fenced.length > 0 ? [fenced[fenced.length - 1]![1]!.trim()] : [s.trim()];
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}
