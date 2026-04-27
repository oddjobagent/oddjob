import type { SearchProvider, SearchProviderOptions, SearchResult } from "./types.ts";

const DEFAULT_BASE_URL = "https://api.search.brave.com/res/v1/web/search";

export const braveProvider: SearchProvider = {
  name: "brave",
  async search(query, opts: SearchProviderOptions): Promise<SearchResult[]> {
    if (!opts.apiKey) throw new Error("brave web_search requires an API key");
    const fetchFn = opts.fetchImpl ?? fetch;
    const url = new URL(opts.baseUrl ?? DEFAULT_BASE_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(opts.maxResults ?? 10));
    const resp = await fetchFn(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": opts.apiKey,
      },
      signal: opts.signal,
    });
    if (!resp.ok)
      throw new Error(`brave search ${resp.status}: ${await resp.text().catch(() => "")}`);
    const data = (await resp.json()) as BraveResponse;
    const out: SearchResult[] = [];
    for (const r of data.web?.results ?? []) {
      out.push({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: stripHtml(r.description ?? r.snippet ?? ""),
      });
    }
    return out;
  },
};

interface BraveResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
      snippet?: string;
    }>;
  };
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
