import type { ProviderCredential, WebSearchOptions, WebSearchResult } from "@oddjob/sdk";

const DEFAULT_BASE_URL = "https://api.tavily.com/search";

interface TavilyResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    score?: number;
    published_date?: string;
  }>;
}

export async function tavilySearch(
  query: string,
  cred: ProviderCredential,
  opts?: WebSearchOptions,
): Promise<readonly WebSearchResult[]> {
  if (!cred.apiKey) throw new Error("tavily web_search requires an API key");
  const fetchFn = opts?.fetchImpl ?? fetch;
  const baseUrl =
    typeof cred.options?.baseUrl === "string" ? (cred.options.baseUrl as string) : DEFAULT_BASE_URL;
  const searchDepth =
    typeof cred.options?.searchDepth === "string" ? cred.options.searchDepth : "basic";
  const resp = await fetchFn(baseUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      api_key: cred.apiKey,
      query,
      max_results: opts?.maxResults ?? 10,
      search_depth: searchDepth,
    }),
    signal: opts?.signal,
  });
  if (!resp.ok) {
    throw new Error(`tavily search ${resp.status}: ${await resp.text().catch(() => "")}`);
  }
  const data = (await resp.json()) as TavilyResponse;
  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
    meta: {
      score: r.score,
      publishedAt: r.published_date,
    },
  }));
}
