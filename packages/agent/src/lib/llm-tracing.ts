/**
 * Wraps a `StreamFn` to emit llm_call step boundaries (open before the call,
 * close on terminal `done`/`error` event) so the eval harness can attribute
 * latency + cost per LLM call. The wrapper is composable with the recording
 * wrapper — apply tracing OUTERMOST so we time the actual provider call,
 * not the recording wrapper's IO.
 */

import type { AssistantMessage, AssistantMessageEvent, Usage } from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export interface LlmCallSpan {
  /** Caller-supplied id stamped onto step rows. */
  stepId: string;
  /** Wall-clock start ms. */
  startedAt: number;
  /** Wall-clock end ms (terminal event observed). */
  endedAt: number;
  /** Final usage from the terminal AssistantMessage, when available. */
  usage?: Usage;
  /** Model id from the resolved model passed to the StreamFn. */
  modelId: string;
  /** Truthy when the terminal event was `error`. */
  errored: boolean;
  /** First-token latency from start, when measurable. */
  firstTokenAt?: number;
}

export interface LlmTracingHooks {
  /** Fired BEFORE the inner stream is invoked. Returns a stepId to use. */
  onStart(modelId: string, startedAt: number): string;
  /** Fired AFTER the terminal event (done or error). */
  onEnd(span: LlmCallSpan): void;
}

const FIRST_TOKEN_TYPES = new Set([
  "text_delta",
  "text_start",
  "thinking_delta",
  "toolcall_delta",
  "toolcall_start",
]);

/**
 * Wraps `inner` so each invocation:
 *  - calls hooks.onStart(...) → step opens
 *  - forwards events as they arrive on a passthrough event stream
 *  - on terminal `done`/`error` event calls hooks.onEnd(span) → step closes
 */
export function tracingWrapper(inner: StreamFn, hooks: LlmTracingHooks): StreamFn {
  return (model, context, options) => {
    const startedAt = Date.now();
    const modelId = model.id;
    const stepId = hooks.onStart(modelId, startedAt);
    let firstTokenAt: number | undefined;

    const out = createAssistantMessageEventStream();

    void (async () => {
      let terminal: AssistantMessageEvent | undefined;
      let errored = false;
      let usage: Usage | undefined;
      try {
        const innerStream = await inner(model, context, options);
        for await (const ev of innerStream) {
          if (firstTokenAt === undefined && FIRST_TOKEN_TYPES.has(ev.type)) {
            firstTokenAt = Date.now();
          }
          if (ev.type === "done") {
            terminal = ev;
            usage = ev.message.usage;
            continue;
          }
          if (ev.type === "error") {
            terminal = ev;
            errored = true;
            usage = ev.error.usage;
            continue;
          }
          out.push(ev);
        }
        // Stream ended without a terminal event — synthesize one so the
        // downstream `result()` resolution doesn't hang. Mark errored so the
        // span's outcome reflects reality.
        if (!terminal) {
          errored = true;
          terminal = {
            type: "error",
            reason: "error",
            error: {
              role: "assistant",
              content: [],
              api: model.api,
              provider: model.provider,
              model: model.id,
              stopReason: "error",
              errorMessage: "stream ended without terminal event",
              usage: EMPTY_USAGE,
              timestamp: Date.now(),
            },
          };
        }
      } catch (err) {
        errored = true;
        const endedAt = Date.now();
        const span: LlmCallSpan = {
          stepId,
          startedAt,
          endedAt,
          usage,
          modelId,
          errored: true,
          ...(firstTokenAt !== undefined ? { firstTokenAt } : {}),
        };
        hooks.onEnd(span);
        const errMsg: AssistantMessage = {
          role: "assistant",
          content: [],
          api: model.api,
          provider: model.provider,
          model: model.id,
          stopReason: "error",
          errorMessage: err instanceof Error ? err.message : String(err),
          usage: EMPTY_USAGE,
          timestamp: Date.now(),
        };
        out.push({ type: "error", reason: "error", error: errMsg });
        out.end();
        return;
      }
      const endedAt = Date.now();
      const span: LlmCallSpan = {
        stepId,
        startedAt,
        endedAt,
        usage,
        modelId,
        errored,
        ...(firstTokenAt !== undefined ? { firstTokenAt } : {}),
      };
      hooks.onEnd(span);
      if (terminal) out.push(terminal);
      out.end();
    })();

    return out;
  };
}
