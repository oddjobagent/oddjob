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
import type { SandboxProvider, SandboxSession } from "../providers/sandbox.ts";
import type { Blueprint } from "../types/blueprint.ts";
import type { Limits } from "../types/limits.ts";
import type { Run, RunId } from "../types/run.ts";
import type { RunOutput } from "../types/output.ts";

import { buildScriptTools } from "./script-tool.ts";

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
}

export interface RunOnceResult {
  run: Run;
  output: RunOutput;
  events: AgentEvent[];
  messages: AgentMessage[];
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
  let usageTotal: Usage | undefined;
  try {
    const tools = buildScriptTools({
      blueprint,
      sandbox: session,
      blueprintDir,
      onLog: append,
    });

    const systemPrompt = buildSystemPrompt(blueprint, systemPromptExtra);
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
        }
        return undefined;
      },
      afterToolCall: async (ctx) => {
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
    const output = extractOutput(finalAssistant, blueprint);
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
    }

    const run: Run = {
      id: runId,
      deploymentId,
      blueprintId: blueprint.id,
      triggeredBy,
      status: isErrorStop(finalAssistant?.stopReason) ? "failed" : "complete",
      input,
      output,
      error: finalAssistant?.errorMessage,
      costUsd: cost,
      tokenInput,
      tokenOutput,
      toolCalls,
      startedAt,
      finishedAt,
      createdAt: startedAt,
    };

    return { run, output, events, messages };
  } finally {
    await session.kill();
  }
}

function isErrorStop(stop: string | undefined): boolean {
  return stop === "error" || stop === "aborted" || stop === "abort";
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

function buildSystemPrompt(blueprint: Blueprint, extra?: string): string {
  const parts: string[] = [];
  parts.push(blueprint.prompt.trim());
  if (blueprint.skills.length > 0) {
    parts.push("");
    parts.push("Skills available (use the skill_load tool to expand):");
    for (const s of blueprint.skills) {
      parts.push(`- ${s}`);
    }
  }
  if (extra) {
    parts.push("");
    parts.push(extra);
  }
  return parts.join("\n");
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
