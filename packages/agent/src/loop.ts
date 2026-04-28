import { randomUUID } from "node:crypto";
import { dirname, isAbsolute } from "node:path";

import {
  type AgentEvent,
  type AgentLoopConfig,
  type AgentMessage,
  runAgentLoop,
} from "@mariozechner/pi-agent-core";
import { type AssistantMessage, type Message, streamSimple, type Usage } from "@mariozechner/pi-ai";

import type { LogEntry, LogProvider } from "@oddjob/core";
import type { AuthProvider } from "@oddjob/core";
import type { McpProvider } from "@oddjob/core";
import type { SecretsProvider } from "@oddjob/core";
import type { EnvironmentProvider, EnvironmentSession } from "@oddjob/core";
import type { Blueprint } from "@oddjob/core";
import type { Limits } from "@oddjob/core";
import type { Run, RunId } from "@oddjob/core";
import type { RunOutput } from "@oddjob/core";

import {
  buildBuiltinTools,
  buildSingleBuiltinTool as buildSingleBuiltinToolDirect,
  type EngineConfig,
} from "./builtin-tools/index.ts";
import { isBuiltinToolName } from "@oddjob/core";
import type { EngineLLM } from "./engine.ts";
import type { PluginRegistry } from "@oddjob/core";
import { startEgressProxy } from "@oddjob/core";
import { deepRedact } from "@oddjob/core";
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
import type { LoadedSkill } from "@oddjob/core";
import { loadSkills } from "./skills.ts";

export interface ResolvedLLM {
  model: import("@mariozechner/pi-ai").Model<import("@mariozechner/pi-ai").Api>;
  apiKey?: string;
}

export interface ResolvedEnvironmentForRun {
  provider: EnvironmentProvider;
  config: import("@oddjob/core").EnvironmentConfig;
}

export interface RunOnceOptions {
  blueprint: Blueprint;
  llm: ResolvedLLM;
  /**
   * Resolved environment for this Run. The worker pool runs the cascade
   * resolver and passes the result here.
   */
  environment: ResolvedEnvironmentForRun;
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
   * `service.build({ environment, blueprintDir, engine, onLog })`. Also lets
   * the web_search / web_fetch dispatchers consult WebSearchService /
   * WebFetchService plugins.
   */
  plugins?: PluginRegistry;
  /**
   * Optional state provider — used by web_search / web_fetch dispatchers to
   * resolve `provider_credentials` rows for the configured plugin.
   */
  state?: import("@oddjob/core").StateProvider;
  /**
   * Optional confirmation gate. Fired before any tool whose name appears in
   * `blueprint.toolPolicies` with `confirm: true`. The harness pauses the
   * agent loop until this resolves; the resolution carries either an `allow`
   * verdict (tool fires normally) or `deny` (tool returns an error result).
   * The worker pool wires this to `POST /api/v1/runs/:id/confirm`.
   */
  onConfirmRequest?: (req: ConfirmRequest) => Promise<ConfirmResolution>;
  /**
   * Fired when an MCP connector returns 401 after a forced token refresh.
   * Receives `<deploymentId>:<connectorName>`. The worker pool wires this to
   * a channel-dispatch hub so users get notified to re-run `oddjob mcp auth`.
   */
  onMcpReauthNeeded?: (tokenKey: string) => Promise<void> | void;
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
  const { blueprint, llm, environment, log, input, limits, signal, systemPromptExtra } = opts;
  const runId = opts.runId ?? randomUUID();
  const deploymentId = opts.deploymentId ?? `_local:${blueprint.id}`;
  const triggeredBy: Run["triggeredBy"] = opts.triggeredBy ?? "manual";
  const startedAt = Date.now();

  const blueprintDir = isAbsolute(blueprint.path) ? dirname(blueprint.path) : process.cwd();
  // HOST-side default workdir the runtime hands every provider at spawn time.
  // Providers that bind-mount (env-docker) use it as the bind source unless
  // the EnvironmentConfig declares a `hostBindDir` override; trusted /
  // local-strict tiers use it as the session workdir (host == session) unless
  // the caller supplied a different one.
  //
  // 15i codex round-3: do NOT fold `environment.config.workingDir` here.
  // `workingDir` is a SANDBOX-INTERNAL path (e.g. "/work" / "/home/daytona/
  // work") per its declared semantics; using it as a host path made
  // `working_dir = "/work"` mean "bind /work on the operator's machine into
  // the container", which fails everywhere except the trusted tier.
  const hostWorkdir = blueprintDir;

  // Start the egress proxy when the env's networking is "limited". The
  // process provider injects HTTPS_PROXY into the spawned shell so all
  // outbound HTTP from the agent + tools goes through it.
  //
  // The engine's required hosts (LLM provider base URLs) are auto-merged
  // into the allowlist so a deployment can't accidentally lock the agent
  // out of its own model API.
  const networking = environment.config.networking;
  // Engine-required hosts (LLM provider base URL + MCP connector hosts) are
  // computed unconditionally so both the egress proxy AND the in-process
  // web_fetch / web_search dispatchers gate against the same union.
  const engineHosts = engineRequiredHosts(llm, blueprint);
  // `envAllowedHosts` is the env's declared allowlist when networking is
  // `"limited"`, undefined otherwise. The web_fetch / web_search dispatchers
  // treat undefined as "no env-side gate" (open networking).
  const envAllowedHosts: readonly string[] | undefined =
    networking?.type === "limited" ? networking.allowedHosts : undefined;
  let egressProxy: { url: string; caPem: string; stop: () => Promise<void> } | undefined;
  if (networking?.type === "limited") {
    const allowedHosts = Array.from(new Set([...networking.allowedHosts, ...engineHosts]));
    // Provider may need the proxy bound on a non-loopback IP so its sessions
    // can reach it. env-docker on Linux returns the docker bridge gateway IP
    // (container loopback != host loopback). undefined means "no opinion;
    // loopback is fine for this tier" (env-process, env-local-strict,
    // env-docker on Mac/Win Docker Desktop).
    //
    // Codex round-2: providers that REQUIRE a custom bind but cannot resolve
    // it (e.g. Linux env-docker without a working `bridge` network) THROW
    // here. We catch and surface a clear error rather than silently falling
    // back to loopback — silent fallback was the bug that made the round-1
    // fix ineffective on Linux.
    let bindAddress: string | undefined;
    try {
      bindAddress = (await environment.provider.proxyBindAddress?.()) ?? undefined;
    } catch (err) {
      throw new Error(
        `egress proxy unreachable from configured environment: ${(err as Error).message}`,
      );
    }
    const handle = await startEgressProxy({
      allowedHosts,
      secrets: opts.secrets,
      blockTokenShapes: true,
      log: log ? { runId, provider: log } : undefined,
      ...(bindAddress ? { bindAddress } : {}),
    });
    egressProxy = handle;
  }

  // Spawn an environment session for this Run. The provider receives the
  // resolved EnvironmentConfig + per-spawn ergonomics (workdir, timeout,
  // abort, optional egress proxy injection). If spawn throws we MUST stop
  // the proxy first so we don't leak a listener.
  let session: EnvironmentSession;
  const events: AgentEvent[] = [];
  const append = (entry: LogEntry) => {
    if (log) void log.log(runId, entry);
  };

  try {
    session = await environment.provider.spawn({
      config: environment.config,
      hostWorkdir,
      // sessionWorkdir is left undefined; the provider chooses its own default
      // (e.g. env-docker → "/work"; env-daytona → "/home/daytona/work") and
      // surfaces the resolved value via session.sessionWorkdir for tools.
      timeoutMs: limits?.durationMs,
      signal,
      egressProxy: egressProxy ? { url: egressProxy.url, caPem: egressProxy.caPem } : undefined,
      onLog: append,
    });
  } catch (err) {
    await egressProxy?.stop().catch(() => undefined);
    throw err;
  }

  let toolCalls = 0;
  let toolErrorCount = 0;
  let lastToolError: string | undefined;
  let lastToolErrorName: string | undefined;
  let verdict: RunVerdict | undefined;
  let hardFailureVerdict: RunVerdict | undefined;
  let usageTotal: Usage | undefined;
  let mcpRuntime: Awaited<ReturnType<typeof buildMcpRuntime>> | undefined;
  try {
    const skills: LoadedSkill[] = blueprint.skills.length > 0 ? loadSkills(blueprint) : [];
    const skillTool = buildSkillTool({ skills, onLog: append });
    const scriptTools = buildScriptTools({
      blueprint,
      environment: session,
      // Script tools resolve sidecar JSON schemas from the host blueprint
      // dir at build-time, but invoke `bun run …` inside the session — so
      // we hand them BOTH the host abs root (for sidecar lookup) and the
      // session-side root (for the in-session script path). The runtime
      // bind-mounts hostWorkdir → sessionWorkdir, and hostWorkdir defaults
      // to blueprintDir, so a script declared as `scripts/parse.ts` resolves
      // to `<sessionWorkdir>/scripts/parse.ts` inside docker / local-strict.
      blueprintDir,
      sessionScriptsRoot: session.sessionWorkdir,
      onLog: append,
    });
    mcpRuntime = await buildMcpRuntime({
      blueprint,
      mcp: opts.mcp,
      secrets: opts.secrets,
      auth: opts.auth,
      deploymentId,
      onReauthNeeded: opts.onMcpReauthNeeded,
    });
    // Tool resolution: ask the plugin registry FIRST for every name in the
    // allowlist; fall back to buildSingleBuiltinTool only if no plugin claims
    // it. This makes the plugin extraction in Phase C end-to-end: disabling
    // tools-core actually disables bash/read/write/etc, and a local plugin
    // can override `bash` by registering its own tool with that name.
    //
    // Builtin tools operate inside the sandbox session — use the SESSION-side
    // workdir (e.g. "/work" in docker) so cwd values passed to `docker exec
    // -w …` resolve inside the container, not on the host filesystem.
    const toolBuildCtx = {
      environment: session,
      blueprintDir: session.sessionWorkdir,
      engine: opts.engine,
      onLog: append,
      plugins: opts.plugins,
      secrets: opts.secrets,
      state: opts.state,
      envAllowedHosts,
      engineRequiredHosts: engineHosts,
    };
    const resolvedTools: ReturnType<typeof buildBuiltinTools> = [];
    const toolNames = new Set<string>();
    for (const entry of blueprint.tools) {
      const name = typeof entry === "string" ? entry : entry;
      if (toolNames.has(name)) continue;
      toolNames.add(name);
      const svc = opts.plugins?.toolFor(name);
      try {
        if (svc) {
          resolvedTools.push(
            svc.build(toolBuildCtx) as (typeof resolvedTools)[number],
          );
          continue;
        }
        if (isBuiltinToolName(name)) {
          // Fallback for setups without a plugin registry (tests, embedded use).
          const built = buildSingleBuiltinToolDirect(name, toolBuildCtx);
          if (built) resolvedTools.push(built as (typeof resolvedTools)[number]);
          continue;
        }
        append({
          timestamp: Date.now(),
          level: "warn",
          message: `tool '${name}' not registered in plugin registry and not a known builtin — skipping`,
        });
      } catch (err) {
        append({
          timestamp: Date.now(),
          level: "error",
          message: `tool '${name}' failed to build: ${(err as Error).message}`,
        });
      }
    }
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
      ...resolvedTools,
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
          meta: { args: deepRedact(ctx.args), toolCalls },
        });
        if (limits?.toolCalls && toolCalls > limits.toolCalls) {
          if (limits.enforce) {
            hardFailureVerdict = {
              outcome: "error",
              reason: `limit exceeded: tool_calls ${toolCalls}/${limits.toolCalls}`,
            };
            append({
              timestamp: Date.now(),
              level: "error",
              message: `tool call limit ${limits.toolCalls} exceeded (enforced, aborting)`,
            });
            return {
              block: true,
              reason: `limit exceeded: tool_calls ${toolCalls}/${limits.toolCalls}`,
            };
          }
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
        level: "error",
        message: `output failed schema validation: ${outputValidation.errors?.map((e) => `${e.path} ${e.message}`).join("; ") ?? "(unknown)"}`,
      });
      if (blueprint.outputSchema) {
        const first = outputValidation.errors?.[0];
        const detail = first ? `${first.path}: ${first.message}` : "(unknown)";
        hardFailureVerdict = {
          outcome: "error",
          reason: `output validation failed: ${detail}`,
        };
      }
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
      if (limits.enforce) {
        hardFailureVerdict = {
          outcome: "error",
          reason: `limit exceeded: budget ${cost.toFixed(4)}/${limits.budgetUsd}`,
        };
        append({
          timestamp: finishedAt,
          level: "error",
          message: `budget ${limits.budgetUsd} USD exceeded, actual ${cost.toFixed(4)} (enforced)`,
        });
      } else {
        append({
          timestamp: finishedAt,
          level: "warn",
          message: `budget ${limits.budgetUsd} USD exceeded, actual ${cost.toFixed(4)} (soft warning)`,
        });
      }
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
    const effectiveVerdict = hardFailureVerdict ?? verdict;
    const classification = classifyRun({
      blueprint,
      verdict: effectiveVerdict,
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
        meta: { toolErrorCount, verdict: effectiveVerdict?.outcome },
      });
    } else if (effectiveVerdict) {
      append({
        timestamp: finishedAt,
        level: "info",
        message: `run complete: ${effectiveVerdict.outcome}`,
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
    // Nested try/finally so a failure in any cleanup step doesn't skip the
    // others (esp. egressProxy.stop() — leaks a TCP listener if skipped).
    try {
      try {
        await mcpRuntime?.close().catch(() => undefined);
      } finally {
        try {
          await session.kill();
        } catch {
          /* swallow — proxy stop must still run */
        }
      }
    } finally {
      await egressProxy?.stop().catch(() => undefined);
    }
  }
}

/**
 * Hosts the engine MUST be able to reach for THIS run. Auto-merged into the
 * env's allowedHosts so a deployment can't accidentally lock the agent out
 * of either its own model API or its declared MCP servers.
 *
 * Sources:
 *   - LLM provider base URL (parsed from `llm.model.baseUrl`)
 *   - HTTP/SSE MCP connector hostnames declared in `blueprint.connectors`
 */
function engineRequiredHosts(llm: ResolvedLLM, blueprint: Blueprint): readonly string[] {
  const hosts = new Set<string>();
  const baseUrl = (llm.model as { baseUrl?: string }).baseUrl;
  if (baseUrl) {
    try {
      hosts.add(new URL(baseUrl).hostname);
    } catch {
      /* malformed url, skip */
    }
  }
  // MCP connectors with HTTP/SSE transport carry an upstream URL — the
  // session needs to reach those for tool calls to succeed.
  for (const conn of Object.values(blueprint.connectors ?? {})) {
    if (conn.transport === "http" || conn.transport === "sse") {
      try {
        hosts.add(new URL(conn.server).hostname);
      } catch {
        /* malformed url, skip */
      }
    }
  }
  return [...hosts];
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
