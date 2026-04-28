// @oddjob/plugin-tools-web-search — registers the `web_search` agent tool plus
// 5 search providers (Brave, Tavily, SearXNG, Exa, SerpAPI). Each provider is
// a WebSearchService keyed by id; engine config selects which the tool uses
// (`[builtin_tools.web_search] plugin = "..."`).

import { definePlugin } from "@oddjob/sdk";

import { braveResolveHost, braveSearch } from "./brave.ts";
import { exaResolveHost, exaSearch } from "./exa.ts";
import { searxngResolveHost, searxngSearch } from "./searxng.ts";
import { serpapiResolveHost, serpapiSearch } from "./serpapi.ts";
import { tavilyResolveHost, tavilySearch } from "./tavily.ts";
import { webSearchTool } from "./web_search.ts";

export default definePlugin(
  {
    slug: "tools-web-search",
    name: "Web Search Tool + Providers",
    description: "web_search tool + bundled providers: Brave, Tavily, SearXNG, Exa, SerpAPI.",
    version: "0.1.0",
    author: "Oddjob",
  },
  (b) => {
    b.tool(webSearchTool);
    b.webSearch({
      id: "brave",
      displayName: "Brave Search",
      authHint: "BRAVE_API_KEY (free tier: 2k queries/month for grandfathered users).",
      search: braveSearch,
      resolveHost: braveResolveHost,
    });
    b.webSearch({
      id: "tavily",
      displayName: "Tavily",
      authHint: "TAVILY_API_KEY (free tier: 1k/month).",
      search: tavilySearch,
      resolveHost: tavilyResolveHost,
    });
    b.webSearch({
      id: "searxng",
      displayName: "SearXNG",
      authHint: "Self-hosted base URL via options.baseUrl. No API key required.",
      search: searxngSearch,
      resolveHost: searxngResolveHost,
    });
    b.webSearch({
      id: "exa",
      displayName: "Exa",
      authHint: "EXA_API_KEY (neural search, per-doc text + highlights).",
      search: exaSearch,
      resolveHost: exaResolveHost,
    });
    b.webSearch({
      id: "serpapi",
      displayName: "SerpAPI",
      authHint: "SERPAPI_API_KEY (Google/Bing/Baidu/etc. via options.engine).",
      search: serpapiSearch,
      resolveHost: serpapiResolveHost,
    });
  },
);
