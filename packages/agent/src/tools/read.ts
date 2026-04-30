import { createReadTool as buildReadTool } from "@mariozechner/pi-coding-agent";

import { makeReadOps, type AnyAgentTool, type CodingToolOptions } from "./coding-adapter.ts";

export function createReadTool(opts: CodingToolOptions): AnyAgentTool {
  return buildReadTool(opts.cwd, { operations: makeReadOps(opts.environment) }) as AnyAgentTool;
}
