// Browserbase (https://browserbase.com/) — managed Chromium with proxy +
// captcha solving. We use their REST scraping endpoint rather than spinning
// up a full browser session: simpler, deterministic, returns rendered HTML.
//
// Endpoint: POST https://api.browserbase.com/v1/scrape  with
//   { url, format: "html"|"markdown"|"text", projectId? }
// Headers: x-bb-api-key.

import type { ProviderCredential, WebFetchOptions, WebFetchResult } from "@oddjob/sdk";

const DEFAULT_BASE_URL = "https://api.browserbase.com/v1";

interface BrowserbaseResponse {
  url?: string;
  status?: number;
  content?: string;
  format?: string;
  metadata?: { title?: string; screenshotUrl?: string };
}

export async function browserbaseFetch(
  url: string,
  cred: ProviderCredential,
  opts?: WebFetchOptions,
): Promise<WebFetchResult> {
  if (!cred.apiKey) throw new Error("browserbase web_fetch requires an API key");
  const fetchFn = opts?.fetchImpl ?? fetch;
  const baseUrl =
    typeof cred.options?.baseUrl === "string" ? (cred.options.baseUrl as string) : DEFAULT_BASE_URL;
  const projectId =
    typeof cred.options?.projectId === "string" ? cred.options.projectId : undefined;

  const resp = await fetchFn(`${baseUrl}/scrape`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bb-api-key": cred.apiKey,
    },
    body: JSON.stringify({
      url,
      format: opts?.renderJs === false ? "html" : "markdown",
      projectId,
    }),
    signal: opts?.signal,
  });
  if (!resp.ok) {
    throw new Error(`browserbase ${resp.status}: ${await resp.text().catch(() => "")}`);
  }
  const data = (await resp.json()) as BrowserbaseResponse;
  const format = (data.format as WebFetchResult["format"]) ?? "markdown";
  return {
    finalUrl: data.url ?? url,
    status: data.status ?? 200,
    body: data.content ?? "",
    format,
    truncated: false,
    meta: {
      title: data.metadata?.title,
      screenshotUrl: data.metadata?.screenshotUrl,
    },
  };
}
