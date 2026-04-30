import { createEditTool as buildEditTool } from "@mariozechner/pi-coding-agent";

import { makeEditOps, type AnyAgentTool, type CodingToolOptions } from "./coding-adapter.ts";

export function createEditTool(opts: CodingToolOptions): AnyAgentTool {
  return buildEditTool(opts.cwd, { operations: makeEditOps(opts.environment) }) as AnyAgentTool;
}
