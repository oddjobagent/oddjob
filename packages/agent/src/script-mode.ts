/**
 * Script-mode runtime (B2.3).
 *
 * When a blueprint has `[entry]` (or a sibling `main.ts` / `main.js`),
 * `runOnce` delegates here instead of driving an LLM agent loop. The
 * blueprint's main module exports a `RunDefinition` (via `@oddjob/sdk`'s
 * `defineRun`); we dynamic-import it, build a `Context` whose every
 * `ctx.*` call is wrapped in `withRunEvent`, and invoke `definition.run(ctx)`.
 *
 * **Sandbox caveat:** script-mode user code runs on the HOST runtime, NOT
 * inside `EnvironmentSession`. Only `ctx.tool` calls (which delegate to
 * existing internal-tool dispatch) execute inside the sandbox. Future
 * work: shell out the user's main.ts inside the session via IPC. Until
 * then, document loud — script blueprints are trusted code.
 *
 * **Replay:** every `ctx.*` call writes a `run_events` row keyed by
 * `(runId, seq)`. Replay returns recorded results without re-executing.
 * Recorded helpers (`ctx.now` / `ctx.uuid` / `ctx.random`) make
 * non-deterministic primitives reproducible. User code MUST NOT call
 * `Date.now()` / `Math.random()` directly — breaks replay.
 *
 * **Concurrent calls:** forbidden in v1. The dispatcher serializes via
 * `assertSerial` from `@oddjob/sdk`. `Promise.all([ctx.fork(...), ...])`
 * throws synchronously on the second dispatch.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";

import { newId, type Blueprint, type EnvironmentSession, type Run, type RunOutput } from "@oddjob/core";
import {
  type Context,
  isRunDefinition,
  PermanentError,
  RetryableError,
  type RunDefinition,
  assertSerial,
} from "@oddjob/sdk";

import type { RunOnceOptions, RunOnceResult } from "./loop.ts";
import { buildInternalTool } from "./tools/index.ts";
import { makeSeqCursor, type SeqCursor, withRunEvent } from "./run-events.ts";

const SCRIPT_MODE_SIBLINGS = ["main.ts", "main.js"] as const;

/**
 * Runtime entry for script-mode blueprints. Mirrors `runOnce`'s contract
 * (same input/output types) but bypasses the agent-loop machinery.
 */
export async function runScriptOnce(opts: RunOnceOptions): Promise<RunOnceResult> {
  const blueprint = opts.blueprint;
  const runId = opts.runId ?? newId("run");
  const deploymentId = opts.deploymentId ?? `_local:${blueprint.id}`;
  const triggeredBy: Run["triggeredBy"] = opts.triggeredBy ?? "manual";
  const startedAt = Date.now();

  const blueprintDir = isAbsolute(blueprint.path) ? dirname(blueprint.path) : process.cwd();
  const entryAbsPath = resolveEntryFile(blueprint, blueprintDir);

  // codex round-16 #2: warn when a script-mode run is dispatched without
  // a run-event provider. The blueprint LOOKS replayable (every ctx.*
  // call goes through withRunEvent), but with no provider every call is
  // a pass-through. Surface this once at startup so callers know they're
  // in best-effort mode.
  if (!opts.runEvents) {
    warnReplayDisabledOnce(blueprint.id);
  }

  // Spawn the environment session — script-mode `ctx.tool` calls execute
  // inside it. The user's main.ts itself runs on the host (documented
  // limitation; future work: ipc-spawn the script inside the session).
  const session: EnvironmentSession = await opts.environment.provider.spawn({
    config: opts.environment.config,
    hostWorkdir: blueprintDir,
    timeoutMs: opts.limits?.durationMs,
    signal: opts.signal,
  });

  // Cumulative cost across this run + every descendant fork.
  let totalCostUsd = 0;
  // ctx.scratch is parent-run-scoped — climb parent_run_id via in-memory
  // map keyed by ROOT runId. v1 has no fork yet so root === self.
  const scratchStore = new Map<string, unknown>();

  const dispatcher = assertSerial();
  // Per-run replay cursor — every ctx.* call allocates its seq from this
  // counter so recording and replay produce identical (runId, seq)
  // sequences. (codex round-12 #1)
  const seqCursor = makeSeqCursor(0);

  const ctx = buildContext({
    runId,
    blueprint,
    blueprintDir,
    inputs: opts.input,
    session,
    scratchStore,
    dispatcher,
    seqCursor,
    runEvents: opts.runEvents,
    onCostDelta: (d: number) => {
      totalCostUsd += d;
    },
    getTotalCost: () => totalCostUsd,
    plugins: opts.plugins,
    secrets: opts.secrets,
    state: opts.state,
    engine: opts.engine,
    ...(opts.signal ? { signal: opts.signal } : {}),
    // Threaded for ctx.fork — child runs inherit the parent's llm +
    // environment + persistence providers + deployment context.
    llm: opts.llm,
    environment: opts.environment,
    log: opts.log,
    step: opts.step,
    messages: opts.messages,
    deploymentId,
  });

  let runError: string | undefined;
  let runStatus: Run["status"] = "complete";
  let runOutput: RunOutput = { finalText: "" };

  try {
    const definition = await loadRunDefinition(entryAbsPath);
    const result = await definition.run(ctx);
    // Surface the result in both fields — finalText for log/dashboard,
    // structuredOutput so eval programmatic checks can read it.
    if (result === undefined || result === null) {
      runOutput = { finalText: "" };
    } else if (typeof result === "string") {
      runOutput = { finalText: result };
    } else if (typeof result === "object") {
      runOutput = {
        finalText: "",
        structuredOutput: result as Record<string, unknown>,
      };
    } else {
      runOutput = { finalText: String(result) };
    }
  } catch (err) {
    runStatus = "failed";
    runError = (err as Error).message ?? String(err);
  } finally {
    await session.kill().catch(() => undefined);
  }

  const finishedAt = Date.now();
  const run: Run = {
    id: runId,
    deploymentId,
    blueprintId: blueprint.id,
    blueprintVersion: blueprint.version,
    blueprintHash: blueprint.contentHash,
    triggeredBy,
    status: runStatus,
    input: opts.input,
    output: runOutput,
    error: runError,
    costUsd: totalCostUsd,
    tokenInput: 0,
    tokenOutput: 0,
    toolCalls: 0,
    createdAt: startedAt,
    startedAt,
    finishedAt,
    ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
  };

  return {
    run,
    output: runOutput,
    events: [] as AgentEvent[],
    messages: [] as AgentMessage[],
    retriable: false,
  };
}

/**
 * Resolve the entry file: explicit `[entry] file` if set, else first
 * existing sibling main.ts/main.js. Throws if neither exists.
 */
function resolveEntryFile(blueprint: Blueprint, blueprintDir: string): string {
  if (blueprint.entry?.file) {
    const explicit = blueprint.entry.file;
    const abs = isAbsolute(explicit) ? explicit : resolve(blueprintDir, explicit);
    if (!existsSync(abs)) {
      throw new Error(
        `script-mode: blueprint declares entry file '${explicit}' which doesn't exist at ${abs}`,
      );
    }
    if (blueprint.entry.runtime !== "bun" && blueprint.entry.runtime !== "node") {
      throw new Error(
        `script-mode: runtime '${blueprint.entry.runtime}' not supported in v1 (only bun/node).`,
      );
    }
    return abs;
  }
  for (const candidate of SCRIPT_MODE_SIBLINGS) {
    const abs = resolve(blueprintDir, candidate);
    if (existsSync(abs)) return abs;
  }
  throw new Error(
    `script-mode: no entry file found at ${blueprintDir} ` +
      `(expected blueprint.entry.file or a sibling ${SCRIPT_MODE_SIBLINGS.join("/")})`,
  );
}

async function loadRunDefinition(absPath: string): Promise<RunDefinition> {
  // pathToFileURL gives a `file://` URL that Bun's import() resolves
  // unambiguously. ES module caching means two runs of the same entry
  // path share one module instance. The RunDefinition is effectively
  // immutable (a function + schemas) so this is fine in production.
  // For dev-time hot-reload, restart the process. (codex round-12 #4)
  const url = pathToFileURL(absPath).href;
  const mod = (await import(url)) as { default?: unknown };
  if (!isRunDefinition(mod.default)) {
    throw new Error(
      `script-mode: ${absPath} default export is not a RunDefinition. ` +
        `Use \`export default defineRun({...}, async (ctx) => {...})\` from @oddjob/sdk.`,
    );
  }
  return mod.default;
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

interface BuildContextArgs {
  runId: string;
  blueprint: Blueprint;
  blueprintDir: string;
  inputs: unknown;
  session: EnvironmentSession;
  scratchStore: Map<string, unknown>;
  dispatcher: ReturnType<typeof assertSerial>;
  seqCursor: SeqCursor;
  runEvents: RunOnceOptions["runEvents"];
  onCostDelta: (delta: number) => void;
  getTotalCost: () => number;
  plugins: RunOnceOptions["plugins"];
  secrets: RunOnceOptions["secrets"];
  state: RunOnceOptions["state"];
  engine: RunOnceOptions["engine"];
  signal?: AbortSignal;
  // ctx.fork needs the parent's runtime context to recursively call
  // runOnce on a child blueprint. v1 inherits parent llm + environment +
  // deploymentId; future work could let blueprint-level overrides flow
  // through.
  llm: RunOnceOptions["llm"];
  environment: RunOnceOptions["environment"];
  log: RunOnceOptions["log"];
  step: RunOnceOptions["step"];
  messages: RunOnceOptions["messages"];
  deploymentId: string;
}

function buildContext(args: BuildContextArgs): Context {
  const { runId, blueprintDir, session, scratchStore, dispatcher, runEvents, seqCursor } = args;

  // Wrap each ctx.* method through the dispatcher + run-event recorder so:
  //   - Concurrent calls fail loud (begin/end pair).
  //   - Every call gets a (runId, seq) row in run_events.
  //   - Replay returns recorded results without re-executing.
  const callViaDispatcher = async <T>(
    callType: string,
    callSite: string,
    callArgs: unknown,
    fn: () => Promise<T>,
    onChildRunId?: () => string | undefined,
  ): Promise<T> => {
    dispatcher.begin(callSite);
    try {
      const seq = seqCursor.next();
      return await withRunEvent(
        runEvents,
        {
          runId,
          callSite,
          callType,
          args: callArgs,
          seq,
          ...(onChildRunId ? { onChildRunId } : {}),
        },
        fn,
      );
    } finally {
      dispatcher.end();
    }
  };

  // Tool dispatch context — same shape the agent loop's resolved tools
  // use. Internal tools (bash/read/write/edit/grep/find/ls/datetime/
  // javascript/python/notes_*) are dispatched via buildInternalTool.
  const toolBuildCtx = {
    environment: session,
    blueprintDir: session.sessionWorkdir ?? blueprintDir,
    engine: args.engine,
    onLog: undefined,
    plugins: args.plugins,
    secrets: args.secrets,
    state: args.state,
    envAllowedHosts: undefined,
    engineRequiredHosts: undefined,
  } as const;

  const ctx: Context = {
    get inputs() {
      return args.inputs as Context["inputs"];
    },
    get totalCostUsd() {
      return args.getTotalCost();
    },
    RetryableError,
    PermanentError,

    memory: {
      async set(key, value, opts) {
        return callViaDispatcher("memory_set", "ctx.memory.set", { key, value, opts }, async () => {
          // v1: memory backed by a per-blueprint kv via state provider when
          // available. Without state, no-op (warn).
          if (!args.state) return;
          // The state provider doesn't expose a deployment-scoped kv yet;
          // wire properly when phases land. For now, swallow.
          // TODO: route through state.kvSet(blueprint.id, key, value)
        });
      },
      async get(key, _schema) {
        return callViaDispatcher("memory_get", "ctx.memory.get", { key }, async () => undefined);
      },
    },

    scratch: {
      async set(key, value) {
        return callViaDispatcher("scratch_set", "ctx.scratch.set", { key, value }, async () => {
          scratchStore.set(key, value);
        });
      },
      async get(key) {
        return callViaDispatcher("scratch_get", "ctx.scratch.get", { key }, async () => {
          return scratchStore.get(key) as never;
        });
      },
    },

    async fork<TIn = unknown, TOut = unknown>(
      blueprintRef: string,
      inputs: TIn,
      _opts?: import("@oddjob/sdk").ForkOptions,
    ): Promise<TOut> {
      let childRunId: string | undefined;
      return callViaDispatcher(
        "fork",
        `ctx.fork(${blueprintRef})`,
        { blueprintRef, inputs },
        async () => {
          // Resolve the ref relative to the parent's blueprint dir.
          // Absolute refs are taken literally; everything else joins with
          // the parent dir so blueprints can refer to siblings via
          // "./researcher" or "../shared/drafter".
          const childPath = isAbsolute(blueprintRef)
            ? blueprintRef
            : resolve(blueprintDir, blueprintRef);
          const { loadBlueprint } = await import("@oddjob/core");
          const childBp = await loadBlueprint(childPath);

          // Lazy import runOnce to avoid circular module init (script-
          // mode.ts is imported FROM loop.ts; pulling runOnce as a
          // top-level import would deadlock).
          const { runOnce: childRunOnce } = await import("./loop.ts");

          childRunId = newId("run");
          const childCreatedAt = Date.now();
          // Persist the child run row BEFORE invoking runOnce so
          // dashboards/queries see the in-flight child immediately AND
          // parent_run_id is durable from the moment fork begins. The
          // child's status starts at "running"; runOnce produces the
          // final Run object which we patch in via updateRun after.
          // (codex round-15 R15-001)
          if (args.state) {
            try {
              await args.state.createRun({
                id: childRunId,
                // Children inherit the parent's deployment so the FK
                // constraint on runs.deployment_id stays satisfied AND
                // dashboards group forks under the parent deployment.
                deploymentId: args.deploymentId,
                blueprintId: childBp.id,
                blueprintVersion: childBp.version,
                blueprintHash: childBp.contentHash,
                triggeredBy: "manual",
                status: "running",
                input: inputs,
                tokenInput: 0,
                tokenOutput: 0,
                toolCalls: 0,
                createdAt: childCreatedAt,
                startedAt: childCreatedAt,
                parentRunId: runId,
              });
            } catch {
              // Persistence is best-effort; the in-memory run still
              // executes. Tests may construct ctx.fork without a state
              // provider via opts.state = undefined.
            }
          }

          const childResult = await childRunOnce({
            blueprint: childBp,
            llm: args.llm,
            environment: args.environment,
            input: inputs,
            runId: childRunId,
            parentRunId: runId,
            ...(args.runEvents ? { runEvents: args.runEvents } : {}),
            ...(args.log ? { log: args.log } : {}),
            ...(args.step ? { step: args.step } : {}),
            ...(args.messages ? { messages: args.messages } : {}),
            ...(args.plugins ? { plugins: args.plugins } : {}),
            ...(args.secrets ? { secrets: args.secrets } : {}),
            ...(args.state ? { state: args.state } : {}),
            ...(args.engine ? { engine: args.engine } : {}),
            ...(args.signal ? { signal: args.signal } : {}),
          });

          // Persist child terminal state so the runs table reflects the
          // final cost / output / error. Best-effort.
          if (args.state) {
            const patch: Partial<typeof childResult.run> = {
              status: childResult.run.status,
              output: childResult.run.output,
              ...(childResult.run.error !== undefined ? { error: childResult.run.error } : {}),
              ...(childResult.run.costUsd !== undefined
                ? { costUsd: childResult.run.costUsd }
                : {}),
              tokenInput: childResult.run.tokenInput,
              tokenOutput: childResult.run.tokenOutput,
              toolCalls: childResult.run.toolCalls,
              ...(childResult.run.finishedAt !== undefined
                ? { finishedAt: childResult.run.finishedAt }
                : {}),
            };
            await args.state.updateRun(childRunId, patch).catch(() => undefined);
          }

          // Propagate the child's terminal status — a failed child
          // throws into the parent's catch, which records the fork
          // run_event row as failed.
          if (childResult.run.status === "failed") {
            throw new Error(
              `ctx.fork('${blueprintRef}') child run ${childRunId} failed: ${childResult.run.error ?? "unknown"}`,
            );
          }

          // Roll up cost so the parent's totalCostUsd includes the child.
          if (typeof childResult.run.costUsd === "number") {
            args.onCostDelta(childResult.run.costUsd);
          }

          // Return the child's structured output (preferred) or the
          // final text. Pi-ai's structured-output extractor populates
          // `output.structuredOutput` when the agent emits fenced JSON;
          // script-mode children populate it directly from their return.
          const out = childResult.output.structuredOutput ?? childResult.output.finalText;
          return out as unknown as TOut;
        },
        () => childRunId,
      );
    },

    mcp(server: string) {
      return {
        async call<T = unknown>(tool: string, callArgs: unknown): Promise<T> {
          return callViaDispatcher("mcp", `ctx.mcp(${server}).call(${tool})`, { server, tool, args: callArgs }, async () => {
            throw new Error(
              `ctx.mcp('${server}').call('${tool}') is deferred to Phase C — ` +
                `script-mode v1 doesn't dispatch MCP via ctx.`,
            );
          });
        },
      };
    },

    async tool<TResult = unknown>(name: string, toolArgs: unknown): Promise<TResult> {
      return callViaDispatcher("tool", `ctx.tool(${name})`, { name, args: toolArgs }, async () => {
        const t = buildInternalTool(name, toolBuildCtx);
        if (!t) {
          throw new Error(
            `ctx.tool('${name}') — unknown tool. Internal tools: bash, read, write, ` +
              `edit, grep, find, ls, datetime, javascript, python, notes_append, notes_read.`,
          );
        }
        const callId = newId("stp");
        const result = await t.execute(callId, toolArgs as never, args.signal);
        // Flatten the AgentToolResult into a string for ctx.tool's return.
        const text = (result.content ?? [])
          .filter((b: unknown): b is { type: "text"; text: string } => {
            const x = b as { type?: string };
            return x?.type === "text";
          })
          .map((b: { text: string }) => b.text)
          .join("\n");
        return text as unknown as TResult;
      });
    },

    async sleep(ms: number) {
      return callViaDispatcher("sleep", "ctx.sleep", { ms }, async () => {
        await new Promise<void>((resolve_) => setTimeout(resolve_, ms));
      });
    },

    async runAgent<TResult = unknown>(opts: import("@oddjob/sdk").RunAgentOptions): Promise<TResult> {
      return callViaDispatcher("runAgent", "ctx.runAgent", opts, async () => {
        throw new Error(
          "ctx.runAgent({...}) is deferred to Phase C — wire blueprint.scripts/connectors via ctx.tool/ctx.mcp instead.",
        );
      });
    },

    async notify(channel: string, message: unknown) {
      return callViaDispatcher("notify", `ctx.notify(${channel})`, { channel, message }, async () => {
        // No-op in v1 — proper channel routing lands with B2.6.
      });
    },

    async now(): Promise<Date> {
      // Recorded helper — replay returns the recorded ISO string as a
      // Date so subsequent runs reproduce time-dependent logic. (codex
      // round-12 #3)
      const iso = await callViaDispatcher("now", "ctx.now", {}, async () =>
        new Date().toISOString(),
      );
      return new Date(iso);
    },
    async uuid(): Promise<string> {
      return callViaDispatcher("uuid", "ctx.uuid", {}, async () => randomUUID());
    },
    async random(): Promise<number> {
      return callViaDispatcher("random", "ctx.random", {}, async () => Math.random());
    },
  };

  return ctx;
}

// Re-export so loop.ts can branch on script-mode without adding another file.
export { isRunDefinition };
export type { RunDefinition, Context };

/**
 * Once-per-process warning when script-mode runs without a run-event
 * provider. Best-effort vs replayable is a load-bearing distinction
 * (codex round-16 #2): every ctx.* call still works, but nothing is
 * recorded and crash recovery is impossible.
 */
const replayWarnedFor = new Set<string>();
function warnReplayDisabledOnce(blueprintId: string): void {
  if (replayWarnedFor.has(blueprintId)) return;
  replayWarnedFor.add(blueprintId);
  // eslint-disable-next-line no-console -- diagnostic surface for missing wiring
  console.warn(
    `[oddjob] script-mode '${blueprintId}': runEvents provider not configured — ` +
      `ctx.* calls will execute live every run, replay/crash-recovery disabled.`,
  );
}
