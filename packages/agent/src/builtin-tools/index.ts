import type { TSchema } from "typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

import {
  BUILTIN_TOOL_NAMES,
  isBuiltinToolName,
  type BuiltinToolName,
  type BuiltinToolsConfig,
  type EngineConfig,
  type EnvironmentSession,
  type LogEntry,
  type PluginRegistry,
  type SecretsProvider,
  type StateProvider,
  type WebFetchConfig,
  type WebSearchConfig,
} from "@oddjob/core";

import { buildCodingTool, isCodingBuiltin } from "./coding-tools-adapter.ts";
import { createDatetimeTool } from "./datetime.ts";
import { createJavascriptReplTool } from "./javascript_repl.ts";
import { createPythonReplTool } from "./python_repl.ts";
import { createWebFetchTool } from "./web_fetch.ts";
import { createWebSearchTool } from "./web_search.ts";

export {
  BUILTIN_TOOL_NAMES,
  isBuiltinToolName,
  type BuiltinToolName,
  type BuiltinToolsConfig,
  type EngineConfig,
  type WebFetchConfig,
  type WebSearchConfig,
};

export interface BuildBuiltinToolsOptions {
  allowlist: readonly string[];
  environment: EnvironmentSession;
  blueprintDir: string;
  engine?: EngineConfig;
  onLog?: (entry: LogEntry) => void;
  /**
   * Optional plugin registry — passed by the agent loop. When set, web_search
   * and web_fetch dispatch through registered WebSearchService /
   * WebFetchService plugins instead of the legacy embedded providers.
   */
  plugins?: PluginRegistry;
  /**
   * Optional secrets provider — used by web_search/web_fetch dispatchers to
   * resolve `provider_credentials` rows for the configured plugin. Test seam
   * left undefined.
   */
  secrets?: SecretsProvider;
  /**
   * Optional state provider — used by web_search/web_fetch dispatchers to
   * look up the current `provider_credentials` row for the configured plugin.
   */
  state?: StateProvider;
  /**
   * Hosts the surrounding environment permits egress to. Set when the env's
   * networking is `"limited"`; left undefined for unrestricted envs. When
   * defined, web_fetch + web_search refuse to dispatch to hosts outside the
   * union of `envAllowedHosts ∪ engineRequiredHosts`. This mirrors the egress
   * proxy gate so the tools can't bypass it by running in the agent process.
   */
  envAllowedHosts?: readonly string[];
  /**
   * Hosts the engine itself must reach (LLM provider base URL + declared MCP
   * server hostnames). Always permitted alongside `envAllowedHosts`. Empty
   * array is fine — only `envAllowedHosts === undefined` disables the gate.
   */
  engineRequiredHosts?: readonly string[];
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
      plugins: opts.plugins,
      secrets: opts.secrets,
      state: opts.state,
      envAllowedHosts: opts.envAllowedHosts,
      engineRequiredHosts: opts.engineRequiredHosts,
    }) as AgentTool<TSchema>;
  }
  if (name === "web_search") {
    return createWebSearchTool({
      config: builtinCfg?.webSearch,
      onLog: opts.onLog,
      plugins: opts.plugins,
      secrets: opts.secrets,
      state: opts.state,
      envAllowedHosts: opts.envAllowedHosts,
      engineRequiredHosts: opts.engineRequiredHosts,
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
