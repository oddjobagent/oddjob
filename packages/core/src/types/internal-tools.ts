// Internal tool catalog + tools-config shapes shared between the agent
// runtime, the dashboard, and blueprint validation. Implementations of
// internals live in @oddjob/agent (packages/agent/src/tools/*);
// plugin-contributed tools live in plugins/* and register through the
// PluginRegistry.

export const INTERNAL_TOOL_NAMES = [
  "bash",
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
  "datetime",
  "javascript",
  "python",
] as const;

export type InternalToolName = (typeof INTERNAL_TOOL_NAMES)[number];

export function isInternalToolName(name: string): name is InternalToolName {
  return (INTERNAL_TOOL_NAMES as readonly string[]).includes(name);
}

export interface EngineConfig {
  builtinTools?: BuiltinToolsConfig;
}

export interface BuiltinToolsConfig {
  webSearch?: WebSearchConfig;
  webFetch?: WebFetchConfig;
  python?: { timeoutMs?: number };
  javascript?: { timeoutMs?: number };
}

export interface WebSearchConfig {
  /**
   * Web-search plugin id to dispatch through. Matches WebSearchService.id
   * (e.g. "brave", "tavily", "searxng", "exa", "serpapi").
   */
  plugin?: string;
  apiKey?: string;
  baseUrl?: string;
  maxResults?: number;
}

export interface WebFetchConfig {
  /**
   * Web-fetch plugin id to dispatch through. Matches WebFetchService.id
   * (e.g. "raw", "browserbase", "firecrawl", "scrapingbee").
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
