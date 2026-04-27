import type { Static } from "typebox";
import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import type { LogEntry } from "../../providers/logging.ts";
import type { WebSearchConfig } from "./index.ts";
import { braveProvider } from "./web_search/brave.ts";
import { searxngProvider } from "./web_search/searxng.ts";
import { tavilyProvider } from "./web_search/tavily.ts";
import type { SearchProvider, SearchResult } from "./web_search/types.ts";

const PROVIDERS: Record<string, SearchProvider> = {
  brave: braveProvider,
  tavily: tavilyProvider,
  searxng: searxngProvider,
};

const schema = Type.Object({
  query: Type.String({ description: "Search query." }),
  max_results: Type.Optional(Type.Number({ description: "Max results (default: 10)." })),
});
type SearchInput = Static<typeof schema>;

interface SearchDetails {
  provider: string;
  resultCount: number;
}

export interface WebSearchToolOptions {
  config?: WebSearchConfig;
  onLog?: (entry: LogEntry) => void;
  fetchImpl?: typeof fetch;
}

export function createWebSearchTool(opts: WebSearchToolOptions = {}): AgentTool<typeof schema> {
  const cfg = opts.config;
  return {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web. Returns title, URL, and snippet for the top results. Provider configured by the engine (brave/tavily/searxng).",
    parameters: schema,
    async execute(_id, params: SearchInput, signal): Promise<AgentToolResult<SearchDetails>> {
      if (!cfg?.provider) {
        return errorResult(
          "web_search not configured — set [builtin_tools.web_search] in ~/.oddjob/config.toml " +
            "(provider = brave|tavily|searxng)",
          "none",
        );
      }
      const provider = PROVIDERS[cfg.provider];
      if (!provider) return errorResult(`unknown provider: ${cfg.provider}`, cfg.provider);

      const start = Date.now();
      try {
        const results = await provider.search(params.query, {
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl,
          maxResults: params.max_results ?? cfg.maxResults ?? 10,
          fetchImpl: opts.fetchImpl,
          signal,
        });
        opts.onLog?.({
          timestamp: Date.now(),
          level: "info",
          message: `web_search ${provider.name} returned ${results.length} results`,
          meta: { durationMs: Date.now() - start, query: params.query },
        });
        return {
          content: [{ type: "text", text: formatResults(results) }],
          details: { provider: provider.name, resultCount: results.length },
        };
      } catch (err) {
        return errorResult((err as Error).message ?? "search failed", provider.name);
      }
    },
  };
}

function errorResult(message: string, provider: string): AgentToolResult<SearchDetails> {
  return {
    content: [{ type: "text", text: `web_search error: ${message}` }],
    details: { provider, resultCount: 0 },
  };
}

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) return "No results.";
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
    .join("\n\n");
}
