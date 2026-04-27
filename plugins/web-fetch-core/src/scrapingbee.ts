// ScrapingBee (https://www.scrapingbee.com/) — proxy + JS render. GET request
// with api_key + url query params returns the rendered page body.

import type { ProviderCredential, WebFetchOptions, WebFetchResult } from "@oddjob/sdk";

const DEFAULT_BASE_URL = "https://app.scrapingbee.com/api/v1/";

export async function scrapingbeeFetch(
  url: string,
  cred: ProviderCredential,
  opts?: WebFetchOptions,
): Promise<WebFetchResult> {
  if (!cred.apiKey) throw new Error("scrapingbee web_fetch requires an API key");
  const fetchFn = opts?.fetchImpl ?? fetch;
  const baseUrl =
    typeof cred.options?.baseUrl === "string" ? (cred.options.baseUrl as string) : DEFAULT_BASE_URL;
  const target = new URL(baseUrl);
  target.searchParams.set("api_key", cred.apiKey);
  target.searchParams.set("url", url);
  if (opts?.renderJs === false) target.searchParams.set("render_js", "false");
  const resp = await fetchFn(target.toString(), { signal: opts?.signal });
  if (!resp.ok) {
    throw new Error(`scrapingbee ${resp.status}: ${await resp.text().catch(() => "")}`);
  }
  const body = await resp.text();
  return {
    finalUrl: url,
    status: resp.status,
    body,
    format: "html",
    truncated: false,
    meta: {
      contentType: resp.headers.get("content-type") ?? undefined,
      cost: resp.headers.get("spb-cost") ?? undefined,
    },
  };
}
