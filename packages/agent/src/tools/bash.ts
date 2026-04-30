import { createBashTool as buildBashTool } from "@mariozechner/pi-coding-agent";

import { makeBashOps, type AnyAgentTool, type CodingToolOptions } from "./coding-adapter.ts";

export function createBashTool(opts: CodingToolOptions): AnyAgentTool {
  return buildBashTool(opts.cwd, { operations: makeBashOps(opts.environment) }) as AnyAgentTool;
}
