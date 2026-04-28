// Raw fetcher — uses Bun's native `fetch` with manual redirect handling, body
// caps, and HTML→markdown via turndown. Same posture as the original
// builtin web_fetch implementation but lifted into a plugin.
//
// SSRF + env-egress guarding is the dispatcher's responsibility for the
// INITIAL URL. For redirects, the dispatcher passes a per-hop `validateUrl`
// callback in opts — we MUST call it on every Location target before
// following, otherwise an allowed origin can 302 us at a private IP /
// disallowed host.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import TurndownService from "turndown";

import type { ProviderCredential, WebFetchOptions, WebFetchResult } from "@oddjob/sdk";

const MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * DNS rebinding mitigation. Resolves the hostname once and returns a URL
 * that points the host portion at the resolved IP, so `fetch()` connects
 * to that exact IP instead of re-resolving (which could land on a private
 * IP between the dispatcher's SSRF/allowlist check and the actual connect).
 *
 * Also returns the original hostname for use as the `Host` request header
 * — upstream virtual-host routing + TLS SNI both rely on it. For TLS,
 * Bun's fetch uses the URL's hostname for SNI; passing an IP defeats SNI.
 * That's an acceptable v1 tradeoff for plain HTTP and HTTPS to an
 * IP-addressable host. Sites that strictly require SNI may break under
 * limited-networking egress; this is documented in SECURITY.md.
 */
async function pinUrl(rawUrl: string): Promise<{ pinnedUrl: URL; originalHost: string }> {
  const u = new URL(rawUrl);
  const original = u.hostname;
  if (isIP(original)) {
    return { pinnedUrl: u, originalHost: original };
  }
  const r = await lookup(original);
  const pinned = new URL(rawUrl);
  pinned.hostname = isIP(r.address) === 6 ? `[${r.address}]` : r.address;
  return { pinnedUrl: pinned, originalHost: original };
}

async function readCapped(
  resp: Response,
  maxBytes: number,
): Promise<{ body: string; bytes: number; truncated: boolean }> {
  if (!resp.body) return { body: "", bytes: 0, truncated: false };
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.length > maxBytes) {
      const remain = maxBytes - total;
      if (remain > 0) chunks.push(value.slice(0, remain));
      total = maxBytes;
      truncated = true;
      reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return { body: new TextDecoder("utf-8", { fatal: false }).decode(buf), bytes: total, truncated };
}

export async function rawFetch(
  url: string,
  _cred: ProviderCredential,
  opts?: WebFetchOptions,
): Promise<WebFetchResult> {
  const fetchFn = opts?.fetchImpl ?? fetch;
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  let target = url;
  let redirects = 0;
  let resp: Response;
  while (true) {
    // Pin the hostname to its resolved IP for the actual connect — closes
    // DNS rebinding window between the dispatcher's allowlist + SSRF check
    // and fetch's own resolver. Tests can opt out via fetchImpl override.
    const { pinnedUrl, originalHost } = opts?.fetchImpl
      ? { pinnedUrl: new URL(target), originalHost: new URL(target).hostname }
      : await pinUrl(target);
    resp = await fetchFn(pinnedUrl.toString(), {
      method: "GET",
      redirect: "manual",
      signal: opts?.signal,
      headers: { "user-agent": "oddjob-web-fetch/0.1", host: originalHost },
    });
    if (resp.status >= 300 && resp.status < 400 && resp.headers.has("location")) {
      if (redirects >= MAX_REDIRECTS) {
        throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
      }
      const next = new URL(resp.headers.get("location")!, target).toString();
      // Re-run the dispatcher's SSRF + env-egress gate on the redirect
      // target. Throws if the next hop violates either policy.
      if (opts?.validateUrl) {
        await opts.validateUrl(next);
      }
      target = next;
      redirects++;
      continue;
    }
    break;
  }
  const contentType = (resp.headers.get("content-type") ?? "").toLowerCase();
  const { body, truncated } = await readCapped(resp, maxBytes);

  let format: WebFetchResult["format"] = "text";
  let rendered = body;
  if (contentType.includes("text/html")) {
    const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    rendered = td.turndown(body);
    format = "markdown";
  } else if (contentType.includes("application/json")) {
    try {
      rendered = JSON.stringify(JSON.parse(body), null, 2);
      format = "json";
    } catch {
      format = "text";
    }
  }
  return {
    finalUrl: target,
    status: resp.status,
    body: rendered,
    format,
    truncated,
    meta: { contentType, redirects },
  };
}
