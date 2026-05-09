import { createHash } from "node:crypto";
import { dirname, isAbsolute } from "node:path";

import {
  type AgentEvent,
  type AgentLoopConfig,
  type AgentMessage,
  runAgentLoop,
  type StreamFn,
} from "@mariozechner/pi-agent-core";
import { type AssistantMessage, type Message, streamSimple, type Usage } from "@mariozechner/pi-ai";

import { newId, type LogEntry, type LogProvider } from "@oddjob/core";
import type { StepKind, StepProvider, StepRecord } from "@oddjob/core";
import type { MessageProvider } from "@oddjob/core";
import type { RunEventProvider } from "@oddjob/core";

import { canonicalJsonStringify } from "./lib/canonical-json.ts";
import { type LlmCallSpan, tracingWrapper } from "./lib/llm-tracing.ts";
import { maybeRecordingFromEnv } from "./lib/recording.ts";
import { CircuitBreaker, withRetryAndBreaker } from "./lib/retry.ts";
import {
  createShowToolResultTool,
  makeTruncateStore,
  withResultTruncation,
} from "./lib/truncate-result.ts";
import { compactHistory, persistCollapsedSegment, planCompaction } from "./compaction.ts";
import { makeSeqCursor } from "./run-events.ts";
import { resolveStrategy } from "./routing/index.ts";
import type { RoutingContext, RoutingDecision } from "./routing/index.ts";
import { createTaskTool, type TaskParentContext } from "./tools/task.ts";

// Per-(provider, baseUrl, modelId) circuit breakers. Sharing a single
// breaker across all runs would let a failing OpenAI route open the
// breaker for unrelated Anthropic runs, and a healthy run on one provider
// would silently reset another's failure streak. Keyed scoping isolates
// failure domains. (codex round 6 #2)
const BREAKERS = new Map<string, CircuitBreaker>();
function breakerFor(llm: ResolvedLLM): CircuitBreaker {
  const key = `${llm.model.provider}|${llm.model.baseUrl ?? ""}|${llm.model.id}`;
  let b = BREAKERS.get(key);
  if (!b) {
    b = new CircuitBreaker();
    BREAKERS.set(key, b);
  }
  return b;
}
import type { AuthProvider } from "@oddjob/core";
import type { McpProvider } from "@oddjob/core";
import type { SecretsProvider } from "@oddjob/core";
import type { EnvironmentProvider, EnvironmentSession } from "@oddjob/core";
import type { Blueprint } from "@oddjob/core";
import type { Limits } from "@oddjob/core";
import type { Run, RunId } from "@oddjob/core";
import type { RunOutput } from "@oddjob/core";

import { buildInternalTool } from "./tools/index.ts";
import { isInternalToolName, type EngineConfig } from "@oddjob/core";
import type { EngineLLM } from "./engine.ts";
import type { PluginRegistry } from "@oddjob/core";
import { startEgressProxy } from "@oddjob/core";
import { deepRedact } from "@oddjob/core";
import { validateOutput } from "./output-validate.ts";
import { buildMcpRuntime } from "./tools/mcp.ts";
import {
  composeOutputSchemaWithChannels,
  type DynamicChannelDescriptor,
} from "./output-schema-compose.ts";
import { buildRevisionPrompt, type GraderEvaluation, runGrader } from "./grader.ts";
import { createReportStatusTool, type RunVerdict } from "./report-status-tool.ts";
import { buildSkillTool } from "./tools/skills.ts";
import { buildScriptTools } from "./tools/scripts.ts";
import { assembleSystemPrompt } from "./system-prompt.ts";
import type { LoadedSkill } from "@oddjob/core";
import { loadSkills } from "./skills.ts";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TSchema } from "typebox";

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
  /**
   * Optional step trace provider. Records llm_call / tool_call / grader /
   * verdict / compaction / classifier / subagent boundaries so the eval
   * harness can attribute cost + latency per step. Failures are swallowed —
   * step-trace MUST never fail a run.
   */
  step?: StepProvider;
  /**
   * Optional run-message provider. When supplied, the compaction path
   * persists the original transcript segment to `run_messages` BEFORE
   * replacing it with the synthetic `<compacted>` summary so replay /
   * debug can recover what was collapsed. (review R-002) Failures are
   * swallowed for the same reason as `step`.
   */
  messages?: MessageProvider;
  /**
   * Optional run-event provider for script-mode `ctx.*` calls (B2.3/B2.4).
   * Supplied by the CLI buildRuntime. Agent-mode runs ignore this. Script-
   * mode runs use it to record/replay every ctx call against `run_events`.
   */
  runEvents?: RunEventProvider;
  /**
   * Set when this Run is a child of another (script-mode `ctx.fork`).
   * Stamped onto `Run.parentRunId` so cost rollup walks the chain.
   * Agent-mode runs leave this undefined.
   */
  parentRunId?: string;
  /**
   * Optional override for the LLM stream function. Defaults to
   * `maybeRecordingFromEnv(streamSimple)` so `ODDJOB_RECORD_FIXTURE` Just
   * Works. The eval CLI passes a replay-from-fixture stream here for
   * token-free regression runs.
   */
  streamFn?: StreamFn;
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
  /**
   * Sub-agent dispatch (Phase 3.2). Set to 1 by the parent's `task` tool
   * when invoking a child runOnce. Children with depth >= 1 reject any
   * `task` tool call (no recursive sub-agents in v1). Default 0.
   */
  subagentDepth?: number;
  /**
   * Step-id of the parent step that spawned this run. Threaded into the
   * child's recordStep calls as `parentStepId` so the dashboard waterfall
   * can render the sub-agent tree. Set by the `task` tool's wrapper.
   */
  parentStepId?: string;
  /**
   * Concurrency tracker for the `task` tool. Map keyed by ROOT runId;
   * each entry tracks in-flight children. Cap is 3 per parent. Shared
   * across all task() invocations of one tree so the cap is global, not
   * per-leaf. Created at the root run; child runs receive the parent's
   * tracker by reference. Phase 3.2.
   */
  taskConcurrencyTracker?: Map<string, number>;
  /**
   * Root run-id of this run's tree (climbs parent_run_id chain). Used
   * to key the task concurrency tracker. Set by the `task` tool when
   * invoking child runOnce; root run leaves it undefined and resolves
   * to its own runId.
   */
  rootRunId?: string;
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
  // Script-mode delegation (B2.3): blueprints with [entry] OR a sibling
  // main.{ts,js,py,go} bypass the agent loop entirely. Lazy-imported to
  // avoid pulling node:url + dynamic-import infrastructure into the
  // agent-mode hot path.
  if (opts.blueprint.scriptMode) {
    const { runScriptOnce } = await import("./script-mode.ts");
    return runScriptOnce(opts);
  }
  const { blueprint, environment, log, input, limits, signal, systemPromptExtra } = opts;
  // `llm` is mutable post-routing-decision (Phase 2). Default = blueprint
  // default; classifier strategies may swap it to a tier-mapped model.
  // Routing is constrained to same provider so engineHosts/egress-proxy
  // allowlist stays valid (see selectRoutingDecision below).
  let llm: ResolvedLLM = opts.llm;
  const runId = opts.runId ?? newId("run");
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
        { cause: err },
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

  // Step trace plumbing. Writes are serialized per-stepId so an open row
  // cannot land after its close on async providers, and a per-run pending
  // queue is awaited in `finally` so `runOnce` doesn't return before the
  // last writes flush.
  let iteration = 0;
  const toolStepIndex = new Map<string, { stepId: string; startedAt: number }>();
  const stepChain = new Map<string, Promise<unknown>>();
  const stepPending = new Set<Promise<unknown>>();
  const recordStep = (rec: StepRecord): void => {
    const provider = opts.step;
    if (!provider) return;
    // Default child runs' step rows to the parent step that spawned
    // them (the tool_call step on the parent's trace) — codex round-19
    // #2. Caller-supplied parentStepId always wins.
    const effective: StepRecord =
      rec.parentStepId === undefined && opts.parentStepId
        ? { ...rec, parentStepId: opts.parentStepId }
        : rec;
    const prev = stepChain.get(rec.stepId) ?? Promise.resolve();
    // Wrap the call in `Promise.resolve().then(...)` so a synchronous throw
    // from a custom provider becomes a normal rejection, not an unhandled.
    const next = prev.then(() =>
      Promise.resolve()
        .then(() => provider.recordStep(effective))
        .catch((err) => {
          append({
            timestamp: Date.now(),
            level: "warn",
            message: `step trace write failed: ${(err as Error).message}`,
          });
        }),
    );
    stepChain.set(rec.stepId, next);
    stepPending.add(next);
    // Use then(cleanup, cleanup) instead of finally so the cleanup chain
    // can't introduce a fresh unhandled rejection.
    const cleanup = (): void => {
      stepPending.delete(next);
      if (stepChain.get(rec.stepId) === next) stepChain.delete(rec.stepId);
    };
    void next.then(cleanup, cleanup);
  };
  const emitPointStep = (kind: StepKind, fields?: Partial<StepRecord>): void => {
    const now = Date.now();
    recordStep({
      stepId: newId("stp"),
      runId,
      iteration,
      kind,
      startedAt: now,
      endedAt: now,
      ...fields,
    });
  };
  const hashArgs = (args: unknown): string => {
    try {
      return createHash("sha256").update(canonicalJsonStringify(args)).digest("hex");
    } catch {
      return "";
    }
  };

  // LLM stream wrapping. Composition order: tracing OUTSIDE recording so the
  // span captures the full call (provider RTT + recording IO). For pure
  // provider-RTT measurement (production runs without ODDJOB_RECORD_FIXTURE),
  // recording is a no-op pass-through, so the timing reflects RTT only. When
  // recording IS enabled, llm_call duration is provider+IO (documented).
  // Replay mode similarly reports replay-read timing — fixture-replay-only
  // baselines must be flagged as such by the eval harness.
  // Resolution order: opts.streamFn (eval/replay caller) → ODDJOB_RECORD_FIXTURE → streamSimple
  const baseStream: StreamFn = opts.streamFn ?? maybeRecordingFromEnv(streamSimple);
  const tracedStream: StreamFn = tracingWrapper(baseStream, {
    onStart: (modelId, startedAtTs) => {
      const stepId = newId("stp");
      recordStep({
        stepId,
        runId,
        iteration,
        kind: "llm_call",
        startedAt: startedAtTs,
        model: modelId,
      });
      return stepId;
    },
    onEnd: (span: LlmCallSpan) => {
      recordStep({
        stepId: span.stepId,
        runId,
        iteration,
        kind: "llm_call",
        startedAt: span.startedAt,
        endedAt: span.endedAt,
        model: span.modelId,
        tokensIn: span.usage?.input,
        tokensOut: span.usage?.output,
        cacheRead: span.usage?.cacheRead,
        cacheWrite: span.usage?.cacheWrite,
        costUsd: span.usage?.cost?.total,
        error: span.errored ? "stream_error" : undefined,
        ...(span.firstTokenAt !== undefined
          ? { meta: { firstTokenLatencyMs: span.firstTokenAt - span.startedAt } }
          : {}),
      });
    },
  });
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
    // Tool resolution. Internal tools (bash/read/write/edit/grep/find/ls/
    // datetime/javascript/python) are built directly by the agent — they
    // bypass the plugin registry. Everything else (web_fetch, web_search,
    // any local plugin tools) goes through the registry.
    //
    // Tools operate inside the sandbox session — use the SESSION-side workdir
    // (e.g. "/work" in docker) so cwd resolves inside the container, not on
    // the host filesystem.
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
    const resolvedTools: AgentTool<TSchema>[] = [];
    const toolNames = new Set<string>();
    for (const entry of blueprint.tools) {
      const name = typeof entry === "string" ? entry : entry;
      if (toolNames.has(name)) continue;
      toolNames.add(name);
      try {
        if (isInternalToolName(name)) {
          const t = buildInternalTool(name, toolBuildCtx);
          if (t) resolvedTools.push(t);
          continue;
        }
        const svc = opts.plugins?.toolFor(name);
        if (svc) {
          resolvedTools.push(svc.build(toolBuildCtx) as AgentTool<TSchema>);
          continue;
        }
        if (opts.plugins?.hasTool(name)) {
          append({
            timestamp: Date.now(),
            level: "warn",
            message: `tool '${name}' is registered but its plugin is disabled — skipping`,
          });
          continue;
        }
        append({
          timestamp: Date.now(),
          level: "warn",
          message: `tool '${name}' not registered in plugin registry — skipping`,
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
            emitPointStep("verdict", { meta: { outcome: v.outcome, reason: v.reason } });
          },
        })
      : undefined;
    // Per-run truncate store. Every tool result text block over
    // MAX_RESULT_BYTES is capped + the overflow stashed here, retrievable
    // via the `show_tool_result` tool (auto-included below). Bypasses
    // report_status because its result is small.
    const truncateStore = makeTruncateStore();
    const wrap = <T extends AgentTool<TSchema>>(t: T): T =>
      withResultTruncation(t, truncateStore) as T;
    const showToolResultTool = createShowToolResultTool(truncateStore) as AgentTool<TSchema>;

    // Phase 3.2: `task` tool registration. The blueprint opts in via
    // `tools = ["task", ...]`. Built here (not via buildInternalTool)
    // because it needs the full parent context — see task.ts.
    const taskRequested = blueprint.tools.includes("task");
    const taskConcurrencyTracker =
      opts.taskConcurrencyTracker ?? new Map<string, number>();
    const rootRunId = opts.rootRunId ?? runId;
    // Per-run replay cursor for run_events. Used by the task tool's
    // withRunEvent wrapper. (script-mode has its own cursor; agent-mode
    // gets one here so task calls can be recorded/replayed.)
    const agentSeqCursor = makeSeqCursor(0);
    // Track current iteration's step id for nested-waterfall plumbing.
    // Task tool reads this lazily so children's step rows reference the
    // parent step that fired the task call. (codex round-18 #6)
    let currentParentStepId: string | undefined = opts.parentStepId;
    let taskTool: AgentTool<TSchema> | undefined;
    if (taskRequested) {
      const taskParent: TaskParentContext = {
        parentRunId: runId,
        parentBlueprint: blueprint,
        // Lazy: routing reassigns `llm` AFTER tools are built, so child
        // must see the post-routing model. (codex round-19 #1)
        parentLlmFn: () => llm,
        parentEnvironment: opts.environment,
        parentSession: session,
        ...(opts.engine ? { parentEngine: opts.engine } : {}),
        ...(opts.plugins ? { parentPlugins: opts.plugins } : {}),
        ...(opts.secrets ? { parentSecrets: opts.secrets } : {}),
        ...(opts.state ? { parentState: opts.state } : {}),
        ...(opts.log ? { parentLog: opts.log } : {}),
        ...(opts.step ? { parentStep: opts.step } : {}),
        ...(opts.messages ? { parentMessages: opts.messages } : {}),
        ...(opts.runEvents ? { parentRunEvents: opts.runEvents } : {}),
        ...(opts.limits?.budgetUsd !== undefined
          ? { parentBudgetUsd: opts.limits.budgetUsd }
          : {}),
        parentTotalCostFn: () => usageTotal?.cost?.total ?? 0,
        ...(opts.limits ? { parentLimits: opts.limits } : {}),
        parentDepth: opts.subagentDepth ?? 0,
        taskConcurrencyTracker,
        rootRunId,
        parentSeqCursor: agentSeqCursor,
        currentParentStepIdFn: () => currentParentStepId,
        onChildResult: (childRunId, costDelta, _finalText) => {
          // Roll child cost into parent usage so the parent's budget
          // gating sees the spend (codex round-18 #1). We synthesize a
          // Usage entry that only carries the cost delta — token counts
          // are omitted because they're already captured in the child's
          // own step rows + persisted run record.
          if (costDelta > 0) {
            usageTotal = sumUsage(usageTotal, {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: costDelta },
            });
          }
          // Emit a `subagent` step on the parent's trace so the
          // dashboard waterfall renders the dispatch row.
          emitPointStep("subagent", {
            costUsd: costDelta,
            meta: { childRunId, rootRunId },
          });
        },
        ...(signal ? { signal } : {}),
        onLog: append,
      };
      taskTool = createTaskTool(taskParent) as AgentTool<TSchema>;
    }

    const tools = [
      ...resolvedTools.map(wrap),
      ...scriptTools.map(wrap),
      ...mcpRuntime.tools.map(wrap),
      ...(skillTool ? [wrap(skillTool)] : []),
      ...(reportStatusTool ? [reportStatusTool] : []),
      ...(taskTool ? [wrap(taskTool)] : []),
      showToolResultTool,
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

    // Routing strategy decision (Phase 2). Runs once before the first
    // invokeAgent. The strategy may swap `llm` to a tier-mapped model on
    // the SAME provider as the blueprint default. Different-provider
    // swaps would invalidate engineHosts / the egress proxy allowlist —
    // resolveModel rejects those.
    const strategy = resolveStrategy(opts.engine?.routing, {
      onWarn: (msg) =>
        append({
          timestamp: Date.now(),
          level: "warn",
          message: `[routing] ${msg}`,
        }),
    });
    // Track classifier usage separately so the `classifier` step row can
    // show its own tokens/cost (vs the routed execution model) — codex
    // round-17 #2.
    let classifierUsage: Usage | undefined;
    // Model that DID the classification. Defaults to the main llm (when
    // no separate classifier model is configured); overridden if the
    // strategy passes `copts.model`.
    let classifierModelId: string | undefined = llm.model.id;
    let classifierActuallyRan = false;
    const routingCtx: RoutingContext = {
      blueprint,
      input,
      async resolveModel(modelId: string) {
        return resolveModelOnSameProvider(llm, modelId);
      },
      async classify(prompt, copts) {
        if (copts?.model) classifierModelId = copts.model;
        classifierActuallyRan = true;
        return classifyOneShot({
          prompt,
          mainLlm: llm,
          modelId: copts?.model,
          maxTokens: copts?.maxTokens ?? 8,
          ...(signal ? { signal } : {}),
          onUsage: (u) => {
            classifierUsage = sumUsage(classifierUsage, u);
            usageTotal = sumUsage(usageTotal, u);
          },
        });
      },
    };
    const routingStartedAt = Date.now();
    let routingDecision: RoutingDecision;
    try {
      routingDecision = await strategy.selectInitial(routingCtx);
    } catch (err) {
      // Routing itself is best-effort — never fail a run on routing.
      append({
        timestamp: Date.now(),
        level: "warn",
        message: `[routing] strategy '${strategy.name}' threw; using blueprint default: ${(err as Error).message}`,
      });
      routingDecision = { reason: `${strategy.name}: error → fallback (${(err as Error).message})` };
    }
    if (routingDecision.llm) {
      llm = routingDecision.llm;
    }
    emitPointStep("classifier", {
      startedAt: routingStartedAt,
      endedAt: Date.now(),
      // model = the model that DID the classification (when classifier
      // ran); the routed execution model lives in meta.executionModel.
      // For `fixed` strategy the classifier never ran, so the model
      // field stays unset.
      ...(classifierActuallyRan ? { model: classifierModelId } : {}),
      ...(classifierUsage?.input !== undefined ? { tokensIn: classifierUsage.input } : {}),
      ...(classifierUsage?.output !== undefined ? { tokensOut: classifierUsage.output } : {}),
      ...(classifierUsage?.cacheRead !== undefined
        ? { cacheRead: classifierUsage.cacheRead }
        : {}),
      ...(classifierUsage?.cacheWrite !== undefined
        ? { cacheWrite: classifierUsage.cacheWrite }
        : {}),
      ...(classifierUsage?.cost?.total !== undefined
        ? { costUsd: classifierUsage.cost.total }
        : {}),
      meta: {
        strategy: strategy.name,
        reason: routingDecision.reason,
        executionModel: llm.model.id,
        ...routingDecision.meta,
      },
    });

    const config: AgentLoopConfig = {
      model: llm.model,
      convertToLlm: (messages: AgentMessage[]) => messages as Message[],
      apiKey: llm.apiKey,
      beforeToolCall: async (ctx) => {
        toolCalls++;
        // Mark that a tool fired so retry-with-jitter cannot re-run this
        // invocation if a downstream LLM error happens later in the turn.
        toolsFiredInThisInvocation = true;
        const stepId = newId("stp");
        const toolStartedAt = Date.now();
        const argsHash = hashArgs(ctx.args);
        toolStepIndex.set(ctx.toolCall.id, { stepId, startedAt: toolStartedAt });
        // Track the firing tool's step id so the task tool can stamp it
        // onto child runs as parentStepId — dashboard waterfall renders
        // sub-agent rows nested under their dispatching tool_call.
        // (codex round-19 #2)
        currentParentStepId = stepId;
        recordStep({
          stepId,
          runId,
          iteration,
          kind: "tool_call",
          startedAt: toolStartedAt,
          toolName: ctx.toolCall.name,
          toolArgsHash: argsHash,
          ...(opts.parentStepId ? { parentStepId: opts.parentStepId } : {}),
        });
        // Closes the open tool_call step row when a gate (limit / approval)
        // blocks execution before afterToolCall fires. Without this the row
        // would dangle with null endedAt + null error.
        const closeBlocked = (reason: string): void => {
          const endedAt = Date.now();
          toolStepIndex.delete(ctx.toolCall.id);
          recordStep({
            stepId,
            runId,
            iteration,
            kind: "tool_call",
            startedAt: toolStartedAt,
            endedAt,
            toolName: ctx.toolCall.name,
            toolArgsHash: argsHash,
            error: reason,
          });
        };
        append({
          timestamp: toolStartedAt,
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
            closeBlocked(`blocked: limit exceeded tool_calls ${toolCalls}/${limits.toolCalls}`);
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
            closeBlocked(
              `denied by user${resolution.denyMessage ? `: ${resolution.denyMessage}` : ""}`,
            );
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
        const endedAt = Date.now();
        const open = toolStepIndex.get(ctx.toolCall.id);
        if (open) {
          toolStepIndex.delete(ctx.toolCall.id);
          recordStep({
            stepId: open.stepId,
            runId,
            iteration,
            kind: "tool_call",
            startedAt: open.startedAt,
            endedAt,
            toolName: ctx.toolCall.name,
            toolResultSize: estimateResultSize(ctx.result),
            error: ctx.isError ? extractErrorText(ctx.result) : undefined,
          });
        }
        append({
          timestamp: endedAt,
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
        // Per-call llm_call step is emitted by the tracingWrapper around the
        // StreamFn (see tracedStream above). Don't double-emit here.
      }
    };

    // Single seam for invoking the agent harness. Both the initial run and
    // each grader-revision pass go through this. Wrapped with retry-with-
    // jitter + a process-wide circuit breaker (B1.2). Pre-call compaction
    // (B1.3) collapses message history when it exceeds the configured ratio
    // of the model's contextWindow. Off by default — flip rule documented
    // in compaction.ts.
    let toolsFiredInThisInvocation = false;
    const compactionCfg = opts.engine?.compaction;
    const compactionLlm: ResolvedLLM = opts.grader?.llm ?? llm;
    const invokeAgent = async (
      newPrompts: AgentMessage[],
      priorMessages: AgentMessage[],
    ): Promise<AgentMessage[]> => {
      toolsFiredInThisInvocation = false;
      // Compaction check happens here so the SAME messages array gets fed
      // into runAgentLoop. Compaction can fire on the second+ invokeAgent
      // call (grader revision) since the first call passes priorMessages=[]
      // — there's nothing to compact on the initial pass.
      let effectivePrior = priorMessages;
      if (compactionCfg?.mode === "auto" && priorMessages.length > 0) {
        const decision = planCompaction(priorMessages, llm.model.contextWindow, compactionCfg);
        if (decision.shouldCompact) {
          const compactStepId = newId("stp");
          const compactStartedAt = Date.now();
          recordStep({
            stepId: compactStepId,
            runId,
            iteration,
            kind: "compaction",
            startedAt: compactStartedAt,
            meta: {
              estimatedTokens: decision.estimatedTokens,
              threshold: decision.threshold,
              contextWindow: decision.contextWindow,
            },
          });
          try {
            const result = await compactHistory(
              priorMessages,
              {
                llm: compactionLlm,
                // Reuse the traced/recorded stream so the summarization
                // call's tokens + cost get attributed AND fixture replay /
                // recording are honored. (codex round 6 #4)
                streamFn: tracedStream,
                ...(signal ? { signal } : {}),
              },
              compactionCfg,
            );
            // Persist the collapsed segment to run_messages BEFORE we
            // replace it on the in-memory side. Once `effectivePrior =
            // result.messages` lands, the originals are gone from the
            // active conversation. Replay / debug needs to recover them.
            // (review R-002)
            if (opts.messages) {
              await persistCollapsedSegment(
                runId,
                priorMessages,
                result,
                opts.messages,
                (err, seq) => {
                  append({
                    timestamp: Date.now(),
                    level: "warn",
                    message: `run-message persist failed at seq ${seq}: ${err.message}`,
                  });
                },
              );
            }
            effectivePrior = result.messages;
            // Roll the summarization usage into the run total — otherwise
            // compaction is invisible to cost reporting.
            if (result.usage) {
              usageTotal = sumUsage(usageTotal, {
                input: result.usage.input,
                output: result.usage.output,
                cacheRead: result.usage.cacheRead ?? 0,
                cacheWrite: result.usage.cacheWrite ?? 0,
                totalTokens: result.usage.input + result.usage.output,
                cost: result.usage.costUsd
                  ? {
                      input: 0,
                      output: 0,
                      cacheRead: 0,
                      cacheWrite: 0,
                      total: result.usage.costUsd,
                    }
                  : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              });
            }
            append({
              timestamp: Date.now(),
              level: "info",
              message: `compaction: collapsed ${result.collapsedRange[1] - result.collapsedRange[0]} messages (${result.collapsedTokens} → ${result.compactedTokens} estimated tokens)`,
            });
            recordStep({
              stepId: compactStepId,
              runId,
              iteration,
              kind: "compaction",
              startedAt: compactStartedAt,
              endedAt: Date.now(),
              model: compactionLlm.model.id,
              tokensIn: result.usage?.input,
              tokensOut: result.usage?.output,
              cacheRead: result.usage?.cacheRead,
              cacheWrite: result.usage?.cacheWrite,
              costUsd: result.usage?.costUsd,
              meta: {
                estimatedTokens: decision.estimatedTokens,
                threshold: decision.threshold,
                contextWindow: decision.contextWindow,
                collapsedRange: result.collapsedRange,
                collapsedTokens: result.collapsedTokens,
                compactedTokens: result.compactedTokens,
              },
            });
          } catch (err) {
            // Compaction failure is non-fatal — fall through with the
            // un-compacted history. The agent loop may then hit a hard
            // context-window limit on the next call, which is no worse
            // than skipping compaction in the first place.
            append({
              timestamp: Date.now(),
              level: "warn",
              message: `compaction failed, continuing without: ${(err as Error).message}`,
            });
            recordStep({
              stepId: compactStepId,
              runId,
              iteration,
              kind: "compaction",
              startedAt: compactStartedAt,
              endedAt: Date.now(),
              error: (err as Error).message,
            });
          }
        }
      }
      return withRetryAndBreaker(
        async () => {
          const out = await runAgentLoop(
            newPrompts,
            { systemPrompt, messages: effectivePrior, tools },
            config,
            onEvent,
            signal,
            tracedStream,
          );
          // Pi-agent-core's stream wrappers synthesize terminal `error`
          // events rather than throwing — so withRetry never sees the
          // failure. Inspect the final assistant message; if stopReason is
          // a non-tool error AND no tool fired, throw a structured error
          // so retry+breaker can fire. (codex round 6 #1)
          const last = out[out.length - 1];
          if (
            last &&
            (last as { role?: string }).role === "assistant" &&
            !toolsFiredInThisInvocation
          ) {
            const stop = (last as { stopReason?: string }).stopReason;
            const errMsg = (last as { errorMessage?: string }).errorMessage;
            if (stop === "error" || stop === "aborted") {
              const err = new Error(
                `provider stream ${stop}: ${errMsg ?? "no error message"}`,
              ) as Error & { code?: string; status?: number };
              // Heuristic classification so withRetry's status/code matchers
              // get a chance to retry. retry.ts's regex on the message
              // catches "529"/"503"/"timeout"/"reset" patterns too.
              if (errMsg && /\b5(29|03|02|04)\b/.test(errMsg)) {
                err.status = Number(errMsg.match(/\b5(29|03|02|04)\b/)?.[0] ?? 502);
              }
              throw err;
            }
          }
          return out;
        },
        breakerFor(llm),
        {
          toolsFiredInTurn: () => toolsFiredInThisInvocation,
          onRetry: (attempt, err, delayMs) => {
            append({
              timestamp: Date.now(),
              level: "warn",
              message: `agent retry ${attempt + 1}: ${(err as Error).message ?? "unknown"} — sleeping ${delayMs}ms`,
            });
          },
        },
      );
    };

    // Initial agent invocation. May iterate when [outcomes.grader] is set.
    let messages = await invokeAgent([userPrompt], []);

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
        iteration = iter + 1;
        const lastAssistant = lastAssistantMessage(messages);
        const artifact = artifactSnapshot(lastAssistant, effectiveBlueprint);
        const graderStepId = newId("stp");
        const graderStartTs = Date.now();
        recordStep({
          stepId: graderStepId,
          runId,
          iteration,
          kind: "grader",
          startedAt: graderStartTs,
          model: graderLlm.model.id,
        });
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
        recordStep({
          stepId: graderStepId,
          runId,
          iteration,
          kind: "grader",
          startedAt: graderStartTs,
          endedAt: Date.now(),
          model: graderLlm.model.id,
          tokensIn: evaluation.usage?.input,
          tokensOut: evaluation.usage?.output,
          costUsd: evaluation.usage?.cost,
          meta: { result: evaluation.result },
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
        messages = await invokeAgent([revision], messages);
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
      ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
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
      // Flush pending step writes so callers (eval CLI, dashboard) see the
      // final tool_call/llm_call/grader/verdict rows. allSettled means a
      // single failed write can't block the others.
      if (stepPending.size > 0) {
        await Promise.allSettled(Array.from(stepPending));
      }
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

/**
 * Resolve a `modelId` to a `ResolvedLLM` constrained to the SAME provider as
 * the run's current llm. Same-provider constraint is load-bearing: the
 * egress proxy allowlist + apiKey are the run's, both scoped to one
 * provider. Cross-provider routing would require both provider hosts
 * pre-allowed and credential resolution per provider — out of v1 scope.
 *
 * Accepts either a bare model id ("claude-haiku-4-5") or a fully-qualified
 * "provider/model" form.
 */
async function resolveModelOnSameProvider(
  current: ResolvedLLM,
  modelId: string,
): Promise<ResolvedLLM> {
  const { getModels } = await import("@mariozechner/pi-ai");
  const provider = current.model.provider;
  // codex round-17 #1: strip a leading provider prefix only when it
  // matches the CURRENT provider. OpenRouter model ids are themselves
  // slash-bearing (e.g. `anthropic/claude-3-5-sonnet`) so blindly
  // splitting on `/` would break those.
  const bareId =
    modelId.startsWith(`${provider}/`) ? modelId.slice(provider.length + 1) : modelId;
  // pi-ai's getModels is typed against a literal KnownProvider union; in
  // practice the model's `.provider` field is one of those values at
  // runtime. Cast to keep the call site agnostic to the union shape.
  const models = getModels(provider as Parameters<typeof getModels>[0]);
  const found = models.find((m) => m.id === bareId);
  if (!found) {
    throw new Error(
      `model '${modelId}' not found on provider '${provider}'. ` +
        `v1 routing requires same-provider tiers (egress + apiKey are scoped to the blueprint's provider).`,
    );
  }
  return {
    model: found as unknown as ResolvedLLM["model"],
    ...(current.apiKey !== undefined ? { apiKey: current.apiKey } : {}),
  };
}

/**
 * One-shot LLM call used by routing strategies (classifier prompt, etc.).
 * Bypasses retry/breaker/recording wrappers — the caller is making a
 * single, cheap-tier call before the main agent loop starts; cost is
 * rolled into `usageTotal` so it shows up in the run's billed usage.
 *
 * Failure is propagated; the strategy decides whether to fall back.
 */
async function classifyOneShot(args: {
  prompt: string;
  mainLlm: ResolvedLLM;
  modelId?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  onUsage?: (u: Usage) => void;
}): Promise<string> {
  const { prompt, mainLlm, modelId, maxTokens, signal, onUsage } = args;
  const target = modelId ? await resolveModelOnSameProvider(mainLlm, modelId) : mainLlm;
  const userMsg: Message = {
    role: "user",
    content: prompt,
    timestamp: Date.now(),
  };
  const out = await streamSimple(
    target.model,
    { messages: [userMsg] },
    {
      ...(target.apiKey !== undefined ? { apiKey: target.apiKey } : {}),
      ...(signal ? { signal } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    },
  );
  let text = "";
  for await (const ev of out) {
    if (ev.type === "done") {
      for (const block of ev.message.content) {
        if (block.type === "text") text += block.text;
      }
      const u = ev.message.usage;
      if (u && onUsage) onUsage(u);
    } else if (ev.type === "error") {
      throw new Error(`classifier stream error: ${ev.error.errorMessage ?? "unknown"}`);
    }
  }
  return text;
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

function estimateResultSize(
  result: { content?: Array<{ type: string; text?: string }> } | undefined,
): number {
  if (!result?.content) return 0;
  let total = 0;
  for (const block of result.content) {
    if (typeof block.text === "string") total += block.text.length;
  }
  return total;
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
