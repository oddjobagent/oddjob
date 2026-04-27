import type { TSchema } from "typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

import type { LogEntry } from "../../providers/logging.ts";
import type { EnvironmentSession } from "../../providers/environment.ts";
import { buildCodingTool, isCodingBuiltin } from "./coding-tools-adapter.ts";
import { createDatetimeTool } from "./datetime.ts";
import { createJavascriptReplTool } from "./javascript_repl.ts";
import { createPythonReplTool } from "./python_repl.ts";
import { createWebFetchTool } from "./web_fetch.ts";
import { createWebSearchTool } from "./web_search.ts";

export interface EngineConfig {
  builtinTools?: BuiltinToolsConfig;
}

export interface BuiltinToolsConfig {
  webSearch?: WebSearchConfig;
  webFetch?: WebFetchConfig;
  pythonRepl?: { timeoutMs?: number };
  javascriptRepl?: { timeoutMs?: number };
}

export interface WebSearchConfig {
  provider: "brave" | "tavily" | "searxng";
  apiKey?: string;
  baseUrl?: string;
  maxResults?: number;
}

export interface WebFetchConfig {
  maxBodyMb?: number;
  privateIpsAllowed?: boolean;
  allowlist?: string[];
  blocklist?: string[];
}

export interface BuildBuiltinToolsOptions {
  allowlist: readonly string[];
  environment: EnvironmentSession;
  blueprintDir: string;
  engine?: EngineConfig;
  onLog?: (entry: LogEntry) => void;
}

export const BUILTIN_TOOL_NAMES = [
  "bash",
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
  "web_fetch",
  "web_search",
  "python_repl",
  "javascript_repl",
  "datetime",
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

export function isBuiltinToolName(name: string): name is BuiltinToolName {
  return (BUILTIN_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Build a single built-in tool by name. Used by `buildBuiltinTools` directly
 * and by the `@oddjob/plugin-builtin-tools` ToolService entries (so the registry
 * can serve the same factories the legacy switch always did).
 */
export function buildSingleBuiltinTool(
  name: string,
  opts: Omit<BuildBuiltinToolsOptions, "allowlist">,
): AgentTool<TSchema> | undefined {
  if (!isBuiltinToolName(name)) return undefined;
  const cwd = opts.blueprintDir;
  const builtinCfg = opts.engine?.builtinTools;
  if (isCodingBuiltin(name)) return buildCodingTool(name, { cwd, environment: opts.environment });
  if (name === "web_fetch") {
    return createWebFetchTool({
      config: builtinCfg?.webFetch,
      onLog: opts.onLog,
    }) as AgentTool<TSchema>;
  }
  if (name === "web_search") {
    return createWebSearchTool({
      config: builtinCfg?.webSearch,
      onLog: opts.onLog,
    }) as AgentTool<TSchema>;
  }
  if (name === "javascript_repl") {
    return createJavascriptReplTool({
      environment: opts.environment,
      defaultTimeoutMs: builtinCfg?.javascriptRepl?.timeoutMs,
      onLog: opts.onLog,
    }) as AgentTool<TSchema>;
  }
  if (name === "python_repl") {
    return createPythonReplTool({
      environment: opts.environment,
      defaultTimeoutMs: builtinCfg?.pythonRepl?.timeoutMs,
      onLog: opts.onLog,
    }) as AgentTool<TSchema>;
  }
  if (name === "datetime") return createDatetimeTool() as AgentTool<TSchema>;
  return undefined;
}

export function buildBuiltinTools(opts: BuildBuiltinToolsOptions): AgentTool<TSchema>[] {
  const tools: AgentTool<TSchema>[] = [];
  for (const name of opts.allowlist) {
    const t = buildSingleBuiltinTool(name, opts);
    if (t) tools.push(t);
  }
  return tools;
}
