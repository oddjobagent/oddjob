// RoutingStrategy — Phase 2 of agent_core_eval. Picks the model for a
// run before the first agent invocation. v1 has a single decision point
// (`selectInitial`); per-invocation / per-turn swapping is deferred
// until pi-agent-core grows the necessary hooks.
//
// Strategies are constructed with typed config (no shared mutable
// state) so eval-compare runs are deterministic and replayable.

import type { Blueprint } from "@oddjob/core";

import type { ResolvedLLM } from "../loop.ts";

export interface RoutingContext {
  blueprint: Blueprint;
  input: unknown;
  /**
   * Resolve a model id to a `ResolvedLLM` using the same plumbing the
   * runtime uses for the blueprint default. Strategies call this to
   * upgrade their decision (string → live llm). Throws if the id can't
   * be resolved (unknown provider/model, missing api key).
   */
  resolveModel(modelId: string): Promise<ResolvedLLM>;
  /**
   * Perform a 1-shot classification call. v1 is BARE BEST-EFFORT — no
   * retry, no circuit breaker, no recording wrapper. Cost is rolled into
   * the run's `usageTotal` (so billing is correct) and a `classifier`
   * step row captures tokens/cost separately. The strategy is expected
   * to handle errors with a fallback decision rather than retrying.
   * Returns the model's raw response text (caller parses).
   */
  classify(prompt: string, opts?: { model?: string; maxTokens?: number }): Promise<string>;
}

/**
 * The decision a strategy returns. `llm: undefined` means "no change —
 * keep the blueprint default." `meta` is recorded verbatim on the
 * `classifier` step row for eval attribution.
 */
export interface RoutingDecision {
  llm?: ResolvedLLM;
  reason: string;
  meta?: Record<string, unknown>;
}

export interface RoutingStrategy {
  name: string;
  selectInitial(ctx: RoutingContext): Promise<RoutingDecision>;
}
