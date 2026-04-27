import type { TSchema } from "typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@mariozechner/pi-coding-agent";

import type { BuiltinToolName } from "./index.ts";

export interface CodingToolsAdapterOptions {
  cwd: string;
}

const FACTORIES = {
  bash: createBashTool,
  read: createReadTool,
  write: createWriteTool,
  edit: createEditTool,
  grep: createGrepTool,
  find: createFindTool,
  ls: createLsTool,
} as const;

export type CodingBuiltinName = keyof typeof FACTORIES;

export function isCodingBuiltin(name: BuiltinToolName): name is CodingBuiltinName {
  return name in FACTORIES;
}

export function buildCodingTool(
  name: CodingBuiltinName,
  opts: CodingToolsAdapterOptions,
): AgentTool<TSchema> {
  return FACTORIES[name](opts.cwd) as unknown as AgentTool<TSchema>;
}
