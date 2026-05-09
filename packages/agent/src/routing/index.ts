// Routing strategies — Phase 2 of agent_core_eval.
//
// Public surface: a `resolveStrategy` factory that turns
// `engine.routing` config into a constructed `RoutingStrategy`. The
// runtime calls `strategy.selectInitial(ctx)` once before the first
// agent invocation; the returned `llm` (if any) overrides the blueprint
// default for the whole run.

import type { RoutingFileConfig } from "@oddjob/core";

import { createClassifierStrategy } from "./classifier.ts";
import { createFixedStrategy } from "./fixed.ts";
import type { RoutingStrategy } from "./strategy.ts";

export { createClassifierStrategy, createFixedStrategy };
export type {
  RoutingContext,
  RoutingDecision,
  RoutingStrategy,
} from "./strategy.ts";
export type { ClassifierConfig, ClassifierLabel } from "./classifier.ts";

export interface ResolveStrategyOptions {
  /** Optional logger for fallback warnings. */
  onWarn?: (msg: string) => void;
}

/**
 * Resolve `engine.routing` config to a constructed `RoutingStrategy`.
 * `undefined` config or `strategy: "fixed"` → no-op fixed strategy.
 * Unknown strategy names fall back to fixed with a warning.
 */
export function resolveStrategy(
  cfg: RoutingFileConfig | undefined,
  opts: ResolveStrategyOptions = {},
): RoutingStrategy {
  const name = cfg?.strategy ?? "fixed";
  if (name === "fixed") return createFixedStrategy();
  if (name === "classifier") {
    return createClassifierStrategy({
      tiers: cfg?.tiers ?? {},
      ...(cfg?.classifierModel ? { classifierModel: cfg.classifierModel } : {}),
      ...(opts.onWarn ? { onWarn: opts.onWarn } : {}),
    });
  }
  // Defensive: schema validation should have caught this before we got
  // here. Fall back to fixed rather than throwing — routing must never
  // be the reason a run fails.
  if (opts.onWarn) {
    opts.onWarn(`unknown routing strategy '${name}'; using fixed`);
  } else {
    // eslint-disable-next-line no-console -- routing diagnostic
    console.warn(`[oddjob:routing] unknown strategy '${name}'; using fixed`);
  }
  return createFixedStrategy();
}
