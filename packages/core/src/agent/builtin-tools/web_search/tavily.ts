import type { SearchProvider, SearchProviderOptions, SearchResult } from "./types.ts";

const DEFAULT_BASE_URL = "https://api.tavily.com/search";

export const tavilyProvider: SearchProvider = {
  name: "tavily",
  async search(query, opts: SearchProviderOptions): Promise<SearchResult[]> {
    if (!opts.apiKey) throw new Error("tavily web_search requires an API key");
    const fetchFn = opts.fetchImpl ?? fetch;
    const resp = await fetchFn(opts.baseUrl ?? DEFAULT_BASE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        api_key: opts.apiKey,
        query,
        max_results: opts.maxResults ?? 10,
        search_depth: "basic",
      }),
      signal: opts.signal,
    });
    if (!resp.ok) {
      throw new Error(`tavily search ${resp.status}: ${await resp.text().catch(() => "")}`);
    }
    const data = (await resp.json()) as TavilyResponse;
    return (data.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.content ?? "",
    }));
  },
};

interface TavilyResponse {
  results?: Array<{ title?: string; url?: string; content?: string }>;
}
