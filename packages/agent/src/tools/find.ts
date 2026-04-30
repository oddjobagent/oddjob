import { createFindTool as buildFindTool } from "@mariozechner/pi-coding-agent";

import { makeFindOps, type AnyAgentTool, type CodingToolOptions } from "./coding-adapter.ts";

export function createFindTool(opts: CodingToolOptions): AnyAgentTool {
  return buildFindTool(opts.cwd, { operations: makeFindOps(opts.environment) }) as AnyAgentTool;
}
