// Firecrawl (https://www.firecrawl.dev/) — JS-rendered scrape that returns
// clean markdown. POST /v1/scrape with { url, formats: ["markdown"] }.

import type { ProviderCredential, WebFetchOptions, WebFetchResult } from "@oddjob/sdk";

const DEFAULT_BASE_URL = "https://api.firecrawl.dev/v1";

interface FirecrawlResponse {
  success?: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: {
      title?: string;
      sourceURL?: string;
      statusCode?: number;
    };
  };
  error?: string;
}

export async function firecrawlFetch(
  url: string,
  cred: ProviderCredential,
  opts?: WebFetchOptions,
): Promise<WebFetchResult> {
  if (!cred.apiKey) throw new Error("firecrawl web_fetch requires an API key");
  const fetchFn = opts?.fetchImpl ?? fetch;
  const baseUrl =
    typeof cred.options?.baseUrl === "string" ? (cred.options.baseUrl as string) : DEFAULT_BASE_URL;
  const formats = opts?.renderJs === false ? ["html"] : ["markdown"];
  const resp = await fetchFn(`${baseUrl}/scrape`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cred.apiKey}`,
    },
    body: JSON.stringify({ url, formats }),
    signal: opts?.signal,
  });
  if (!resp.ok) {
    throw new Error(`firecrawl ${resp.status}: ${await resp.text().catch(() => "")}`);
  }
  const data = (await resp.json()) as FirecrawlResponse;
  if (!data.success || !data.data) {
    throw new Error(`firecrawl error: ${data.error ?? "unknown"}`);
  }
  const md = data.data.markdown;
  const html = data.data.html;
  const body = md ?? html ?? "";
  const format: WebFetchResult["format"] = md ? "markdown" : "html";
  return {
    finalUrl: data.data.metadata?.sourceURL ?? url,
    status: data.data.metadata?.statusCode ?? 200,
    body,
    format,
    truncated: false,
    meta: { title: data.data.metadata?.title },
  };
}
