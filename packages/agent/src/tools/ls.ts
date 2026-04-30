import { createLsTool as buildLsTool } from "@mariozechner/pi-coding-agent";

import { makeLsOps, type AnyAgentTool, type CodingToolOptions } from "./coding-adapter.ts";

export function createLsTool(opts: CodingToolOptions): AnyAgentTool {
  return buildLsTool(opts.cwd, { operations: makeLsOps(opts.environment) }) as AnyAgentTool;
}
