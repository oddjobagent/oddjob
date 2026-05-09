// `task` tool — sub-agent dispatch (Phase 3.2 of agent_core_eval).
//
// Spawns a child runOnce from inside the parent's agent loop. The child
// reuses the parent's blueprint (with a stripped tool list), shares the
// parent's environment session, inherits engine.routing, and rolls cost
// back into the parent's usage. Hard caps:
//   - depth ≤ 1 (no recursive task-from-task)
//   - concurrent children ≤ 3 per parent tree
//   - child.limits.budgetUsd = parent.budgetUsd - parentTotalCost
//
// Replay: the task call is wrapped in `withRunEvent` so a re-run with
// the same parent runId reuses the recorded child runId + final text
// without re-executing the child. Mirrors ctx.fork (B2.4).
//
// Codex round-18 #1 — child budget is propagated as remaining-budget,
// not the full blueprint budget, so child can't overspend the tree.
// #2 — environment session is shared via a no-op-kill adapter.

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "typebox";

import {
  newId,
  type Blueprint,
  type EnvironmentProvider,
  type EnvironmentRunConfig,
  type EnvironmentSession,
  type Limits,
  type LogEntry,
  type LogProvider,
  type MessageProvider,
  type PluginRegistry,
  type RunEventProvider,
  type SecretsProvider,
  type StateProvider,
  type StepProvider,
} from "@oddjob/core";

import { withRunEvent, type SeqCursor } from "../run-events.ts";
import type { ResolvedLLM, ResolvedEnvironmentForRun } from "../loop.ts";

const TASK_INPUT_SCHEMA = Type.Object({
  prompt: Type.String({
    minLength: 1,
    description:
      "The sub-task to delegate. The child agent runs in its own loop with this as the user prompt.",
  }),
  tools_subset: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      description:
        "Optional subset of the parent's tools to expose to the child. If omitted, child gets the parent's full tool list MINUS `task` itself.",
    }),
  ),
  max_tokens: Type.Optional(
    Type.Integer({
      minimum: 100,
      description:
        "Optional output budget for the child run. Folds into child Limits.tokenBudget. Default = unbounded (parent's budget).",
    }),
  ),
});

type TaskInput = Static<typeof TASK_INPUT_SCHEMA>;

export const MAX_SUBAGENT_DEPTH = 1;
export const MAX_CONCURRENT_CHILDREN = 3;

export interface TaskParentContext {
  /** The parent's runId. */
  parentRunId: string;
  /** Parent's blueprint — child clones it (with filtered tools). */
  parentBlueprint: Blueprint;
  /**
   * Parent's main llm — read LAZILY so the child sees the post-routing
   * model. The task tool is built before routing fires; capturing llm
   * eagerly would seed children with the pre-routing blueprint default.
   * (codex round-19 #1)
   */
  parentLlmFn: () => ResolvedLLM;
  /** Resolved environment for the parent. Child shares its session via no-op-kill adapter. */
  parentEnvironment: ResolvedEnvironmentForRun;
  /** Active environment session (the spawned one). */
  parentSession: EnvironmentSession;
  /** Parent's engine config — child inherits engine.routing + engine.compaction. */
  parentEngine?: import("@oddjob/core").EngineConfig;
  /** Parent's plugins, secrets, state, log, step, messages, runEvents. */
  parentPlugins?: PluginRegistry;
  parentSecrets?: SecretsProvider;
  parentState?: StateProvider;
  parentLog?: LogProvider;
  parentStep?: StepProvider;
  parentMessages?: MessageProvider;
  parentRunEvents?: RunEventProvider;
  /**
   * Parent's `limits.budgetUsd` (or undefined for unbounded). Child's
   * budget = parent.budgetUsd - parentTotalCostFn() at task call time.
   * Computing it lazily lets sequential task() calls in the same parent
   * see updated remaining budget.
   */
  parentBudgetUsd?: number;
  /** Lazy getter for parent's accumulated cost. Called once per task() invocation. */
  parentTotalCostFn: () => number;
  /** Other parent limits (durationMs, toolCalls, tokenBudget). Child inherits as-is. */
  parentLimits?: Limits;
  /** Parent's depth (0 at root). Child sees parentDepth + 1; rejects if >= MAX_SUBAGENT_DEPTH. */
  parentDepth: number;
  /** Concurrency tracker (Map<rootRunId, count>); same instance flows through the tree. */
  taskConcurrencyTracker: Map<string, number>;
  /** Root runId for this run's tree (climbed parent_run_id chain). */
  rootRunId: string;
  /** Parent's seq cursor for run_events — needed when wrapping with withRunEvent. */
  parentSeqCursor: SeqCursor;
  /**
   * Parent step-id of the agent loop's current iteration. Threaded
   * into the child's recordStep calls as parentStepId so dashboard
   * waterfall renders nested rows. Lazy lookup so we always grab the
   * current step.
   */
  currentParentStepIdFn: () => string | undefined;
  /** Hook fired with child's RunOnceResult for cost rollup + step emission. */
  onChildResult: (childRunId: string, costDelta: number, finalText: string) => void;
  /** Optional abort signal from parent. */
  signal?: AbortSignal;
  /** Append log entries to parent's log stream. */
  onLog?: (entry: LogEntry) => void;
}

/**
 * Build the `task` tool with full parent context. Called from loop.ts
 * after blueprint resolution; not via `buildInternalTool` because that
 * shared context can't carry parent-runOnce semantics.
 */
export function createTaskTool(parent: TaskParentContext): AgentTool<typeof TASK_INPUT_SCHEMA> {
  // Lazy-import runOnce to break circular dependency (loop.ts imports
  // task.ts, task.ts needs runOnce).
  return {
    name: "task",
    label: "Sub-agent task",
    description: [
      "Delegate a sub-task to a child agent. Use for self-contained sub-problems",
      "(research a topic, summarize a file, draft a code snippet) where the parent",
      "agent can hand off and consume only the final answer.",
      "",
      `Hard caps: depth ≤ ${MAX_SUBAGENT_DEPTH} (no recursive task-from-task), concurrent`,
      `children ≤ ${MAX_CONCURRENT_CHILDREN} per parent tree. Cost rolls into the parent run.`,
    ].join("\n"),
    parameters: TASK_INPUT_SCHEMA,
    async execute(
      _id: string,
      args: TaskInput,
      _signal: AbortSignal | undefined,
    ): Promise<AgentToolResult<{ childRunId?: string; costDelta?: number; error?: string }>> {
      // Depth gate: enforced at the TOOL CALL site so the rejection
      // surfaces as a normal tool-result error the agent can see.
      if (parent.parentDepth >= MAX_SUBAGENT_DEPTH) {
        return errorResult(
          `task tool: max sub-agent depth (${MAX_SUBAGENT_DEPTH}) exceeded — recursive task-from-task is not allowed in v1`,
        );
      }
      // Concurrency gate.
      const inFlight = parent.taskConcurrencyTracker.get(parent.rootRunId) ?? 0;
      if (inFlight >= MAX_CONCURRENT_CHILDREN) {
        return errorResult(
          `task tool: concurrent children limit (${MAX_CONCURRENT_CHILDREN}) reached at this parent`,
        );
      }
      // Filter child's tool list (default = parent's tools minus 'task').
      const requested = args.tools_subset ?? parent.parentBlueprint.tools.filter((t) => t !== "task");
      const allowed = requested.filter((t) => parent.parentBlueprint.tools.includes(t) && t !== "task");
      if (allowed.length === 0) {
        return errorResult(
          "task tool: child must have at least one tool. Pass tools_subset or ensure parent has non-task tools.",
        );
      }
      // Compute child's remaining budget — codex round-18 #1.
      const remainingBudget =
        parent.parentBudgetUsd !== undefined
          ? Math.max(0, parent.parentBudgetUsd - parent.parentTotalCostFn())
          : undefined;
      if (remainingBudget !== undefined && remainingBudget <= 0) {
        return errorResult(
          `task tool: parent has exhausted its $${parent.parentBudgetUsd?.toFixed(4)} budget — refusing to spawn child`,
        );
      }
      // Allocate the child runId BEFORE wrapping in withRunEvent so the
      // recorded run_event row carries it as `child_run_id`.
      const childRunId = newId("run");
      parent.taskConcurrencyTracker.set(parent.rootRunId, inFlight + 1);
      try {
        // Replay-aware: on re-run with same parent runId, withRunEvent
        // returns the recorded { childRunId, finalText, costDelta }
        // and the child runOnce never executes again.
        const recorded = await withRunEvent(
          parent.parentRunEvents,
          {
            runId: parent.parentRunId,
            seq: parent.parentSeqCursor.next(),
            callSite: "tool:task",
            callType: "tool",
            args: {
              prompt: args.prompt,
              tools_subset: allowed,
              ...(args.max_tokens !== undefined ? { max_tokens: args.max_tokens } : {}),
            },
            // childRunId is recorded on the run_event row so debug /
            // dashboards can locate the child without re-execution.
            onChildRunId: () => childRunId,
          },
          async () => executeChild(parent, args, allowed, childRunId, remainingBudget),
        );
        // Roll cost back into parent's usageTotal + emit subagent step.
        parent.onChildResult(recorded.childRunId, recorded.costDelta, recorded.finalText);
        return {
          content: [{ type: "text", text: recorded.finalText }],
          details: { childRunId: recorded.childRunId, costDelta: recorded.costDelta },
        };
      } finally {
        parent.taskConcurrencyTracker.set(
          parent.rootRunId,
          (parent.taskConcurrencyTracker.get(parent.rootRunId) ?? 1) - 1,
        );
      }
    },
  };
}

interface ChildExecutionResult {
  childRunId: string;
  costDelta: number;
  finalText: string;
}

async function executeChild(
  parent: TaskParentContext,
  args: TaskInput,
  allowedTools: string[],
  childRunId: string,
  remainingBudget: number | undefined,
): Promise<ChildExecutionResult> {
  // Synthesize child blueprint: clone parent, replace tools, drop
  // outcomes (child returns text, not a verdict).
  const childBlueprint: Blueprint = {
    ...parent.parentBlueprint,
    tools: allowedTools,
    outcomes: undefined,
    // Carry parent's prompt through; the user prompt for the child run
    // is `args.prompt`, passed via opts.input to runOnce.
  };

  // Shared session wrapper — codex round-18 #2.
  const sharedEnv: ResolvedEnvironmentForRun = {
    provider: makeSharedSessionProvider(parent.parentSession),
    config: parent.parentEnvironment.config,
  };

  const childLimits: Limits | undefined = parent.parentLimits
    ? {
        ...parent.parentLimits,
        ...(remainingBudget !== undefined ? { budgetUsd: remainingBudget } : {}),
      }
    : undefined;
  // Note: args.max_tokens is recorded in the run_event row but not
  // currently enforced — Limits doesn't model a per-run token budget.
  // Hooking into pi-agent-core's tokenBudget is a v1.1 follow-up.

  // Lazy import to break circular ref.
  const { runOnce } = await import("../loop.ts");
  const result = await runOnce({
    blueprint: childBlueprint,
    llm: parent.parentLlmFn(),
    environment: sharedEnv,
    runId: childRunId,
    parentRunId: parent.parentRunId,
    rootRunId: parent.rootRunId,
    subagentDepth: parent.parentDepth + 1,
    taskConcurrencyTracker: parent.taskConcurrencyTracker,
    input: args.prompt,
    ...(parent.parentEngine ? { engine: parent.parentEngine } : {}),
    ...(parent.parentPlugins ? { plugins: parent.parentPlugins } : {}),
    ...(parent.parentSecrets ? { secrets: parent.parentSecrets } : {}),
    ...(parent.parentState ? { state: parent.parentState } : {}),
    ...(parent.parentLog ? { log: parent.parentLog } : {}),
    ...(parent.parentStep ? { step: parent.parentStep } : {}),
    ...(parent.parentMessages ? { messages: parent.parentMessages } : {}),
    ...(parent.parentRunEvents ? { runEvents: parent.parentRunEvents } : {}),
    ...(childLimits ? { limits: childLimits } : {}),
    ...(parent.signal ? { signal: parent.signal } : {}),
    ...(parent.currentParentStepIdFn()
      ? { parentStepId: parent.currentParentStepIdFn() as string }
      : {}),
  });

  // Surface a failed child as a descriptive error result rather than
  // empty text — codex round-19 #3. The parent agent sees a clear
  // failure signal it can react to (retry, fall back, escalate).
  if (result.run.status !== "complete") {
    const errMsg = result.run.error ?? `child status ${result.run.status}`;
    return {
      childRunId,
      costDelta: result.run.costUsd ?? 0,
      finalText: `[task failed] child run ${childRunId} ended with status=${result.run.status}: ${errMsg}`,
    };
  }
  return {
    childRunId,
    costDelta: result.run.costUsd ?? 0,
    finalText: result.output.finalText ?? "(child returned no text)",
  };
}

/**
 * EnvironmentProvider that returns an existing parent session unchanged
 * and no-ops `kill()`. Lets a child runOnce share the parent's session
 * without owning its lifecycle.
 */
function makeSharedSessionProvider(parentSession: EnvironmentSession): EnvironmentProvider {
  // Wrap the session so kill() is a no-op (parent owns lifecycle).
  const sharedSession: EnvironmentSession = {
    sessionWorkdir: parentSession.sessionWorkdir,
    exec: parentSession.exec.bind(parentSession),
    writeFile: parentSession.writeFile.bind(parentSession),
    readFile: parentSession.readFile.bind(parentSession),
    async kill() {
      // No-op: parent owns the session.
    },
    ...(parentSession.snapshot ? { snapshot: parentSession.snapshot.bind(parentSession) } : {}),
    ...(parentSession.fork ? { fork: parentSession.fork.bind(parentSession) } : {}),
    ...(parentSession.pause ? { pause: parentSession.pause.bind(parentSession) } : {}),
    ...(parentSession.resume ? { resume: parentSession.resume.bind(parentSession) } : {}),
    ...(parentSession.exposePort
      ? { exposePort: parentSession.exposePort.bind(parentSession) }
      : {}),
  };
  return {
    name: "shared-session-task-child",
    async connect() {
      // No-op: provider has no real connection.
    },
    async disconnect() {
      // No-op.
    },
    async healthy() {
      return true;
    },
    async spawn(_config: EnvironmentRunConfig) {
      return sharedSession;
    },
  };
}

function errorResult(
  msg: string,
): AgentToolResult<{ childRunId?: string; costDelta?: number; error?: string }> {
  return {
    content: [{ type: "text", text: `[task error] ${msg}` }],
    details: { error: msg },
  };
}
