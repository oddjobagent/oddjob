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
import type { SandboxProvider, SandboxSession } from "../providers/sandbox.ts";
import type { Blueprint } from "../types/blueprint.ts";
import type { Limits } from "../types/limits.ts";
import type { Run, RunId } from "../types/run.ts";
import type { RunOutput } from "../types/output.ts";

import { buildBuiltinTools, type EngineConfig } from "./builtin-tools/index.ts";
import { validateOutput } from "./output-validate.ts";
import { buildMcpRuntime } from "./mcp-tool.ts";
import {
  composeOutputSchemaWithChannels,
  type DynamicChannelDescriptor,
} from "./output-schema-compose.ts";
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
  sandbox: SandboxProvider;
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
}

export interface RunOnceResult {
  run: Run;
  output: RunOutput;
  events: AgentEvent[];
  messages: AgentMessage[];
  verdict?: RunVerdict;
  /** Whether the run is retry-eligible (verdict.outcome === "warning"). */
  retriable: boolean;
}

export async function runOnce(opts: RunOnceOptions): Promise<RunOnceResult> {
  const { blueprint, llm, sandbox, log, input, limits, signal, systemPromptExtra } = opts;
  const runId = opts.runId ?? randomUUID();
  const deploymentId = opts.deploymentId ?? `_local:${blueprint.id}`;
  const triggeredBy: Run["triggeredBy"] = opts.triggeredBy ?? "manual";
  const startedAt = Date.now();

  const blueprintDir = isAbsolute(blueprint.path) ? dirname(blueprint.path) : process.cwd();
  const session: SandboxSession = await sandbox.spawn({
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
      sandbox: session,
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
      sandbox: session,
      blueprintDir,
      engine: opts.engine,
      onLog: append,
    });
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
            outputSchema: composeOutputSchemaWithChannels(
              blueprint.outputSchema,
              dynamicChannels,
            ),
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

    const messages = await runAgentLoop(
      [userPrompt],
      { systemPrompt, messages: [], tools },
      config,
      (e: AgentEvent) => {
        events.push(e);
        if (e.type === "message_end" && e.message.role === "assistant") {
          const u = (e.message as AssistantMessage).usage;
          if (u) usageTotal = sumUsage(usageTotal, u);
        }
      },
      signal,
      streamSimple,
    );

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
    if (verdict.outcome === "success") return { failed: false, retriable: false, errorMessage: undefined };
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
