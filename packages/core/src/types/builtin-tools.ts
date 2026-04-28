// Built-in tool catalog + user-facing config shapes.
//
// The catalog (names + type-guard) and config shapes are contracts shared
// between the agent runtime, the dashboard, and blueprint validation. The
// build implementations live in @oddjob/agent.

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
  /**
   * Web-search plugin id to dispatch through. Matches WebSearchService.id
   * (e.g. "brave", "tavily", "searxng", "exa", "serpapi"). When omitted, the
   * builtin tool falls back to the legacy embedded provider via `provider`.
   */
  plugin?: string;
  /** @deprecated. Use `plugin` instead. */
  provider?: "brave" | "tavily" | "searxng";
  apiKey?: string;
  baseUrl?: string;
  maxResults?: number;
}

export interface WebFetchConfig {
  /**
   * Web-fetch plugin id to dispatch through. Matches WebFetchService.id
   * (e.g. "raw", "browserbase", "firecrawl", "scrapingbee"). Defaults to
   * "raw" when the plugin registry has it registered.
   */
  plugin?: string;
  apiKey?: string;
  maxBodyMb?: number;
  privateIpsAllowed?: boolean;
  allowlist?: string[];
  blocklist?: string[];
  /** Whether to render JS (browser-based fetchers honor this). */
  renderJs?: boolean;
}
