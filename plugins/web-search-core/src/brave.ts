import type { ProviderCredential, WebSearchOptions, WebSearchResult } from "@oddjob/sdk";

import { hostFromBaseUrl } from "./host-from-baseurl.ts";

const DEFAULT_BASE_URL = "https://api.search.brave.com/res/v1/web/search";

export function braveResolveHost(cred: ProviderCredential): string | undefined {
  const opt = typeof cred.options?.baseUrl === "string" ? cred.options.baseUrl : undefined;
  return hostFromBaseUrl(opt, DEFAULT_BASE_URL);
}

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

export async function braveSearch(
  query: string,
  cred: ProviderCredential,
  opts?: WebSearchOptions,
): Promise<readonly WebSearchResult[]> {
  if (!cred.apiKey) throw new Error("brave web_search requires an API key");
  const fetchFn = opts?.fetchImpl ?? fetch;
  const baseUrl =
    typeof cred.options?.baseUrl === "string" ? (cred.options.baseUrl as string) : DEFAULT_BASE_URL;
  const url = new URL(baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(opts?.maxResults ?? 10));
  const resp = await fetchFn(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": cred.apiKey,
    },
    signal: opts?.signal,
  });
  if (!resp.ok)
    throw new Error(`brave search ${resp.status}: ${await resp.text().catch(() => "")}`);
  const data = (await resp.json()) as BraveResponse;
  const out: WebSearchResult[] = [];
  for (const r of data.web?.results ?? []) {
    out.push({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: stripHtml(r.description ?? r.snippet ?? ""),
    });
  }
  return out;
}
