// `defineRun` — the entry point a script-mode `main.ts` exports.
//
// This package does NOT execute the run. It packages the user's function +
// schemas into a `RunDefinition` object stamped with `__oddjobRun: true` so
// the runtime (in @oddjob/agent, B2.3) can recognize and unwrap it.
//
// Example usage in a blueprint's main.ts:
//
//   import { defineRun } from "@oddjob/sdk";
//   import { Type } from "typebox";
//
//   const inputSchema = Type.Object({ url: Type.String() });
//   const outputSchema = Type.Object({ summary: Type.String() });
//
//   export default defineRun(
//     { inputSchema, outputSchema },
//     async (ctx) => {
//       const html = await ctx.tool<string>("web_fetch", { url: ctx.inputs.url });
//       return { summary: html.slice(0, 500) };
//     },
//   );

import type { Context } from "./context.ts";

/** Stable marker the runtime checks via `value?.__oddjobRun === true`. */
export const ODDJOB_RUN_MARKER = "__oddjobRun" as const;

export interface DefineRunOptions {
  /**
   * JSON-Schema or typebox-compiled schema for the inputs. Optional — if
   * omitted, `ctx.inputs` is `unknown`. The blueprint TOML's `[input_schema]`
   * still applies independently; both are validated.
   */
  inputSchema?: unknown;
  /**
   * JSON-Schema or typebox-compiled schema for the return value. Optional —
   * if omitted, the runtime accepts whatever the function returns.
   */
  outputSchema?: unknown;
}

/**
 * Run function signature. Receives a fully-bound `Context` and returns the
 * (validated) output. Throwing `RetryableError` re-queues the run; throwing
 * `PermanentError` (or any other error) hard-fails it.
 */
export type RunFn<TInputs, TOutput> = (ctx: Context<TInputs>) => Promise<TOutput>;

/**
 * Wrapped run definition. The runtime imports the blueprint's `main.ts`,
 * reads `default`, and asserts `value?.__oddjobRun === true` before calling
 * `value.run(ctx)`.
 *
 * `__oddjobRun` is a stable string marker (not a symbol) so the wire format
 * remains language-portable — a future Python SDK port could emit the same
 * shape via JSON.
 */
export interface RunDefinition<TInputs = unknown, TOutput = unknown> {
  readonly [ODDJOB_RUN_MARKER]: true;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
  readonly run: RunFn<TInputs, TOutput>;
}

/**
 * Package a run function + schemas into a `RunDefinition`. Pure — does not
 * execute anything. The runtime in @oddjob/agent (B2.3) reads the result.
 */
export function defineRun<TInputs = unknown, TOutput = unknown>(
  opts: DefineRunOptions,
  fn: RunFn<TInputs, TOutput>,
): RunDefinition<TInputs, TOutput> {
  return {
    [ODDJOB_RUN_MARKER]: true,
    inputSchema: opts.inputSchema,
    outputSchema: opts.outputSchema,
    run: fn,
  };
}

/** Type guard for the runtime importing a blueprint's main.ts default. */
export function isRunDefinition(value: unknown): value is RunDefinition {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Record<string, unknown>)[ODDJOB_RUN_MARKER] === true &&
    typeof (value as Record<string, unknown>).run === "function"
  );
}
