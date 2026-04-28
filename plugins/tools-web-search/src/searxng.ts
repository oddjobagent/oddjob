import type { ProviderCredential, WebSearchOptions, WebSearchResult } from "@oddjob/sdk";

import { hostFromBaseUrl } from "./host-from-baseurl.ts";

export function searxngResolveHost(cred: ProviderCredential): string | undefined {
  const opt = typeof cred.options?.baseUrl === "string" ? cred.options.baseUrl : undefined;
  // No default — searxng is always self-hosted; the dispatcher fails closed
  // when both the credential.baseUrl and options.baseUrl are absent.
  return hostFromBaseUrl(opt, cred.baseUrl);
}

interface SearxngResponse {
  results?: Array<{ title?: string; url?: string; content?: string }>;
}

export async function searxngSearch(
  query: string,
  cred: ProviderCredential,
  opts?: WebSearchOptions,
): Promise<readonly WebSearchResult[]> {
  const baseUrl =
    typeof cred.options?.baseUrl === "string" ? (cred.options.baseUrl as string) : cred.baseUrl;
  if (!baseUrl) throw new Error("searxng web_search requires options.baseUrl");
  const fetchFn = opts?.fetchImpl ?? fetch;
  const url = new URL(baseUrl.replace(/\/$/, "") + "/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  const resp = await fetchFn(url.toString(), {
    headers: { accept: "application/json" },
    signal: opts?.signal,
  });
  if (!resp.ok) {
    throw new Error(`searxng search ${resp.status}: ${await resp.text().catch(() => "")}`);
  }
  const data = (await resp.json()) as SearxngResponse;
  const max = opts?.maxResults ?? 10;
  return (data.results ?? []).slice(0, max).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }));
}
