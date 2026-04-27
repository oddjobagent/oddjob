// Exa (https://exa.ai/). Neural-search API; supports `numResults`, `useAutoprompt`,
// per-doc text content, highlights. We map to the standard WebSearchResult.

import type { ProviderCredential, WebSearchOptions, WebSearchResult } from "@oddjob/sdk";

const DEFAULT_BASE_URL = "https://api.exa.ai/search";

interface ExaResponse {
  results?: Array<{
    title?: string;
    url?: string;
    text?: string;
    score?: number;
    publishedDate?: string;
    author?: string;
  }>;
}

export async function exaSearch(
  query: string,
  cred: ProviderCredential,
  opts?: WebSearchOptions,
): Promise<readonly WebSearchResult[]> {
  if (!cred.apiKey) throw new Error("exa web_search requires an API key");
  const fetchFn = opts?.fetchImpl ?? fetch;
  const baseUrl =
    typeof cred.options?.baseUrl === "string" ? (cred.options.baseUrl as string) : DEFAULT_BASE_URL;
  const useAutoprompt = cred.options?.useAutoprompt !== false;
  const resp = await fetchFn(baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cred.apiKey,
    },
    body: JSON.stringify({
      query,
      numResults: opts?.maxResults ?? 10,
      useAutoprompt,
      contents: { text: { maxCharacters: 1000 } },
    }),
    signal: opts?.signal,
  });
  if (!resp.ok) {
    throw new Error(`exa search ${resp.status}: ${await resp.text().catch(() => "")}`);
  }
  const data = (await resp.json()) as ExaResponse;
  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.text ? r.text.slice(0, 500) : "",
    meta: {
      score: r.score,
      publishedAt: r.publishedDate,
      author: r.author,
    },
  }));
}
