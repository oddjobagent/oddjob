import { createWriteTool as buildWriteTool } from "@mariozechner/pi-coding-agent";

import { makeWriteOps, type AnyAgentTool, type CodingToolOptions } from "./coding-adapter.ts";

export function createWriteTool(opts: CodingToolOptions): AnyAgentTool {
  return buildWriteTool(opts.cwd, { operations: makeWriteOps(opts.environment) }) as AnyAgentTool;
}
