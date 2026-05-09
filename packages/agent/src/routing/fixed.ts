// `fixed` routing strategy — no-op. Preserves the blueprint's default
// model. Default for any run that doesn't configure routing.

import type { RoutingContext, RoutingDecision, RoutingStrategy } from "./strategy.ts";

export function createFixedStrategy(): RoutingStrategy {
  return {
    name: "fixed",
    async selectInitial(_ctx: RoutingContext): Promise<RoutingDecision> {
      return { reason: "fixed: blueprint default" };
    },
  };
}
