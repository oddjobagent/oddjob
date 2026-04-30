import {
  createSessionGrepTool,
  type AnyAgentTool,
  type CodingToolOptions,
} from "./coding-adapter.ts";

export function createGrepTool(opts: CodingToolOptions): AnyAgentTool {
  return createSessionGrepTool(opts.cwd, opts.environment) as AnyAgentTool;
}
