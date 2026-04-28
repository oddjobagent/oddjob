// SerpAPI (https://serpapi.com/). GET /search?engine=google&q=...&api_key=...
// Returns "organic_results" with title/link/snippet.

import type { ProviderCredential, WebSearchOptions, WebSearchResult } from "@oddjob/sdk";

import { hostFromBaseUrl } from "./host-from-baseurl.ts";

const DEFAULT_BASE_URL = "https://serpapi.com/search";

export function serpapiResolveHost(cred: ProviderCredential): string | undefined {
  const opt = typeof cred.options?.baseUrl === "string" ? cred.options.baseUrl : undefined;
  return hostFromBaseUrl(opt, DEFAULT_BASE_URL);
}

interface SerpApiResponse {
  organic_results?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
    displayed_link?: string;
    position?: number;
  }>;
}

export async function serpapiSearch(
  query: string,
  cred: ProviderCredential,
  opts?: WebSearchOptions,
): Promise<readonly WebSearchResult[]> {
  if (!cred.apiKey) throw new Error("serpapi web_search requires an API key");
  const fetchFn = opts?.fetchImpl ?? fetch;
  const baseUrl =
    typeof cred.options?.baseUrl === "string" ? (cred.options.baseUrl as string) : DEFAULT_BASE_URL;
  const engine = typeof cred.options?.engine === "string" ? cred.options.engine : "google";
  const url = new URL(baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("engine", engine);
  url.searchParams.set("num", String(opts?.maxResults ?? 10));
  url.searchParams.set("api_key", cred.apiKey);
  const resp = await fetchFn(url.toString(), { signal: opts?.signal });
  if (!resp.ok) {
    throw new Error(`serpapi search ${resp.status}: ${await resp.text().catch(() => "")}`);
  }
  const data = (await resp.json()) as SerpApiResponse;
  return (data.organic_results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.link ?? "",
    snippet: r.snippet ?? "",
    meta: { position: r.position, displayedLink: r.displayed_link },
  }));
}
