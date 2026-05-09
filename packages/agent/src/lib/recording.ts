/**
 * LLM stream recording / replay primitive.
 *
 * Wraps a pi-ai `streamSimple`-shaped function so each invocation either
 *  - appends a `{request, events, usage}` JSONL line to disk (record mode), or
 *  - reads the next JSONL line and replays its events (replay mode).
 *
 * Distinct from pi-ai's faux provider:
 *  - faux  = unit-deterministic, scripted responses
 *  - record/replay = full-run regression of REAL provider responses, captured
 *    once and replayed without burning tokens.
 */

import { createHash } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";

import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  SimpleStreamOptions,
  Usage,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";

import { canonicalJsonStringify } from "./canonical-json.ts";

// ---------------------------------------------------------------------------
// JSONL line shape
// ---------------------------------------------------------------------------

/** Captured shape for one LLM stream invocation. */
export interface RecordedCall {
  /** Subset of the request that's safe + useful to compare on replay. */
  request: RecordedRequest;
  /** All events the inner stream emitted, in order. */
  events: AssistantMessageEvent[];
  /** Final usage from the terminal AssistantMessage (`done` or `error`). */
  usage: Usage;
}

export interface RecordedRequest {
  modelId: string;
  provider: string;
  api: string;
  systemPrompt?: string;
  messageCount: number;
  toolNames: string[];
  /**
   * sha256 of canonical-serialised request body
   * `{systemPrompt, messages, tools, options}`.
   *
   * On replay we re-hash the live request and compare. A mismatch means the
   * caller's prompt / messages / tool schemas / options drifted from what
   * was recorded — the recorded response is no longer a valid stand-in.
   * Without this field, replay accepts any request that happens to match
   * modelId + messageCount + toolNames, which silently masks regressions
   * in prompt content or tool parameters. (review R-001)
   */
  requestHash?: string;
  /** Free-form passthrough of stream options (sans signal). Useful for diagnosis. */
  options?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// recording wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps `inner` so each invocation appends a JSONL line to `path`.
 *
 * Returns a stream that mirrors the inner stream (events forwarded as they
 * arrive). The JSONL line is written when the inner stream terminates
 * (`done` or `error`).
 */
export function recordingWrapper(inner: StreamFn, path: string): StreamFn {
  return (model, context, options) => {
    const out = createAssistantMessageEventStream();
    const captured: AssistantMessageEvent[] = [];
    const requestSnapshot = snapshotRequest(model, context, options);

    void (async () => {
      let final: AssistantMessage | undefined;
      let terminal: AssistantMessageEvent | undefined;
      try {
        const innerStream = await inner(model, context, options);
        for await (const ev of innerStream) {
          captured.push(ev);
          if (ev.type === "done") {
            final = ev.message;
            terminal = ev;
            continue; // hold terminal until after file flush
          }
          if (ev.type === "error") {
            final = ev.error;
            terminal = ev;
            continue;
          }
          out.push(ev); // forward non-terminal events live
        }
        if (final) {
          const line: RecordedCall = {
            request: requestSnapshot,
            events: captured,
            usage: final.usage,
          };
          // Flush BEFORE pushing the terminal event. Consumers that exit
          // their for-await on `done`/`error` are then guaranteed to see
          // the JSONL line on disk.
          await appendFile(path, `${JSON.stringify(line)}\n`, "utf8");
        }
      } finally {
        if (terminal) out.push(terminal);
        out.end();
      }
    })();

    return out;
  };
}

// ---------------------------------------------------------------------------
// replay
// ---------------------------------------------------------------------------

/**
 * Produces a `StreamFn` that reads JSONL lines from `path` and replays them
 * in order. Each call consumes one line.
 *
 * Throws loud on:
 *  - more calls than recorded lines
 *  - request shape mismatch (model id, message count, tool names)
 *  - malformed JSONL
 */
export function replayFromJsonl(path: string): StreamFn {
  let cache: RecordedCall[] | undefined;
  let cursor = 0;

  const load = async (): Promise<RecordedCall[]> => {
    if (cache) return cache;
    const raw = await readFile(path, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    cache = lines.map((line, i) => {
      try {
        return JSON.parse(line) as RecordedCall;
      } catch (err) {
        throw new Error(
          `replayFromJsonl: malformed JSONL at line ${i + 1} of ${path}: ${(err as Error).message}`,
          { cause: err },
        );
      }
    });
    return cache;
  };

  return (model, context, options) => {
    const out = createAssistantMessageEventStream();
    const expected = snapshotRequest(model, context, options);
    const idx = cursor++;

    void (async () => {
      try {
        const recorded = await load();
        if (idx >= recorded.length) {
          throw new Error(
            `replayFromJsonl: ran out of recorded calls (call #${idx + 1}, only ${recorded.length} recorded in ${path})`,
          );
        }
        const entry = recorded[idx];
        if (!entry) {
          throw new Error(`replayFromJsonl: missing entry at index ${idx}`);
        }
        assertRequestMatches(expected, entry.request, idx, path);
        for (const ev of entry.events) out.push(ev);
        out.end();
      } catch (err) {
        // Replay-side mismatches are programmer/regression errors. Surface
        // the descriptive message on the stream's terminal AssistantMessage
        // so consumers see `stopReason: "error"` + a clear `errorMessage`.
        // `await stream.result()` resolves to that message; the agent loop
        // already treats stopReason="error" as a hard failure.
        const message = err instanceof Error ? err.message : String(err);
        const errMsg: AssistantMessage = {
          role: "assistant",
          content: [],
          api: model.api,
          provider: model.provider,
          model: model.id,
          stopReason: "error",
          errorMessage: `replayFromJsonl: ${message}`,
          usage: emptyUsage(),
          timestamp: Date.now(),
        };
        out.push({ type: "error", reason: "error", error: errMsg });
        out.end();
      }
    })();

    return out;
  };
}

// ---------------------------------------------------------------------------
// env-driven helper
// ---------------------------------------------------------------------------

/**
 * Returns `recordingWrapper(inner, path)` if `ODDJOB_RECORD_FIXTURE` is set
 * to a non-empty path. Otherwise returns `inner` unchanged.
 *
 * Keeps wiring trivial for `oddjob eval --record`.
 */
export function maybeRecordingFromEnv(inner: StreamFn): StreamFn {
  const path = process.env.ODDJOB_RECORD_FIXTURE;
  if (!path || path.trim().length === 0) return inner;
  return recordingWrapper(inner, path);
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function snapshotRequest(
  model: Model<string>,
  context: Context,
  options: SimpleStreamOptions | undefined,
): RecordedRequest {
  const sanitized = options ? sanitizeOptions(options) : undefined;
  return {
    modelId: model.id,
    provider: model.provider,
    api: model.api,
    systemPrompt: context.systemPrompt,
    messageCount: context.messages.length,
    toolNames: (context.tools ?? []).map((t) => t.name).toSorted(),
    requestHash: hashRequestBody(context, sanitized),
    options: sanitized,
  };
}

/**
 * Canonical hash over the parts of the request that, if changed, should
 * invalidate a recorded response. Tools are hashed by `name + parameters`
 * (the schema) so a parameter rename / type change invalidates replay even
 * when the tool name is unchanged. Messages are hashed in order — both role
 * and content matter.
 */
function hashRequestBody(
  context: Context,
  options: Record<string, unknown> | undefined,
): string {
  const tools = (context.tools ?? [])
    .map((t) => ({ name: t.name, parameters: t.parameters as unknown }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const body = {
    systemPrompt: context.systemPrompt ?? "",
    messages: context.messages,
    tools,
    options: options ?? {},
  };
  return createHash("sha256").update(canonicalJsonStringify(body)).digest("hex");
}

function sanitizeOptions(options: SimpleStreamOptions): Record<string, unknown> {
  // Strip non-serializable / volatile fields. AbortSignal, headers, etc.
  // We only keep flat scalars worth diffing.
  const out: Record<string, unknown> = {};
  if (options.temperature !== undefined) out.temperature = options.temperature;
  if (options.maxTokens !== undefined) out.maxTokens = options.maxTokens;
  if (options.reasoning !== undefined) out.reasoning = options.reasoning;
  return out;
}

function assertRequestMatches(
  expected: RecordedRequest,
  recorded: RecordedRequest,
  callIndex: number,
  path: string,
): void {
  const mismatches: string[] = [];
  if (expected.modelId !== recorded.modelId) {
    mismatches.push(`modelId: expected=${expected.modelId} recorded=${recorded.modelId}`);
  }
  if (expected.messageCount !== recorded.messageCount) {
    mismatches.push(
      `messageCount: expected=${expected.messageCount} recorded=${recorded.messageCount}`,
    );
  }
  const a = expected.toolNames.join(",");
  const b = recorded.toolNames.join(",");
  if (a !== b) {
    mismatches.push(`toolNames: expected=[${a}] recorded=[${b}]`);
  }
  // Content-level check: requestHash covers systemPrompt + messages + tool
  // schemas + options. If only this differs, the shape is right but the
  // underlying prompt / messages / tool parameters drifted — the recorded
  // response is stale. We surface a short diagnostic about WHICH field
  // moved so the caller doesn't have to diff hashes blind.
  if (
    expected.requestHash !== undefined &&
    recorded.requestHash !== undefined &&
    expected.requestHash !== recorded.requestHash
  ) {
    const why = describeContentMismatch(expected, recorded);
    mismatches.push(`requestHash: content drifted (${why})`);
  }
  if (mismatches.length > 0) {
    throw new Error(
      `replayFromJsonl: request shape mismatch at call #${callIndex + 1} of ${path}\n  ${mismatches.join("\n  ")}`,
    );
  }
}

function describeContentMismatch(expected: RecordedRequest, recorded: RecordedRequest): string {
  const reasons: string[] = [];
  if ((expected.systemPrompt ?? "") !== (recorded.systemPrompt ?? "")) {
    reasons.push("systemPrompt changed");
  }
  if (canonicalJsonStringify(expected.options) !== canonicalJsonStringify(recorded.options)) {
    reasons.push("options changed");
  }
  // Tool name diff caught above; remaining hash diff implies messages or tool
  // parameters. Don't try to identify the exact message — the caller can
  // re-record if needed.
  if (reasons.length === 0) {
    reasons.push("messages or tool parameters changed");
  }
  return reasons.join("; ");
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
