import type { SearchProvider, SearchProviderOptions, SearchResult } from "./types.ts";

export const searxngProvider: SearchProvider = {
  name: "searxng",
  async search(query, opts: SearchProviderOptions): Promise<SearchResult[]> {
    if (!opts.baseUrl) throw new Error("searxng web_search requires baseUrl");
    const fetchFn = opts.fetchImpl ?? fetch;
    const url = new URL(opts.baseUrl.replace(/\/$/, "") + "/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    const resp = await fetchFn(url.toString(), {
      headers: { accept: "application/json" },
      signal: opts.signal,
    });
    if (!resp.ok) {
      throw new Error(`searxng search ${resp.status}: ${await resp.text().catch(() => "")}`);
    }
    const data = (await resp.json()) as SearxngResponse;
    const max = opts.maxResults ?? 10;
    return (data.results ?? []).slice(0, max).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.content ?? "",
    }));
  },
};

interface SearxngResponse {
  results?: Array<{ title?: string; url?: string; content?: string }>;
}
