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

class RebindBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RebindBlockedError";
  }
}

/**
 * Resolved-IP validator. Defense-in-depth against DNS rebinding: the
 * dispatcher's `assertSafeUrl` resolves once and validates the IP at gate
 * time; we re-resolve here at connect time and re-validate, so an attacker
 * who controls the hostname's DNS can't rebind between the gate and our
 * fetch. Mirrors the ssrf guard's CIDR sets so behavior is consistent.
 */
function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast/reserved
  return false;
}
function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice(7);
    return isIP(v4) === 4 ? isPrivateV4(v4) : false;
  }
  return false;
}

/**
 * DNS rebinding mitigation for plain HTTP. Resolves the hostname, validates
 * the resolved IP isn't private/sensitive, then returns a URL whose host is
 * the IP literal so `fetch()` connects to that exact IP instead of
 * re-resolving. Sets `Host` header to the original hostname for upstream
 * virtual-host routing.
 *
 * For HTTPS we deliberately do NOT rewrite the hostname — TLS SNI + cert
 * verification both use the URL hostname, and Bun's fetch follows that. We
 * still re-resolve and validate the IP (so an obvious rebind to RFC1918 is
 * caught), then return the original URL unchanged. The residual rebind
 * window for HTTPS is the same compromise the proxy uses for CONNECT
 * tunneling — documented in SECURITY.md.
 *
 * Throws RebindBlockedError if the resolved IP fails the private-IP check.
 */
async function pinUrl(rawUrl: string): Promise<{ pinnedUrl: URL; originalHost: string }> {
  const u = new URL(rawUrl);
  const original = u.hostname;
  if (isIP(original)) return { pinnedUrl: u, originalHost: original };
  const r = await lookup(original);
  const v = isIP(r.address);
  if (v === 4 && isPrivateV4(r.address)) {
    throw new RebindBlockedError(
      `${original} resolves to private IPv4 ${r.address} (DNS rebinding blocked)`,
    );
  }
  if (v === 6 && isPrivateV6(r.address)) {
    throw new RebindBlockedError(
      `${original} resolves to private IPv6 ${r.address} (DNS rebinding blocked)`,
    );
  }
  // HTTPS: do not rewrite hostname (preserves SNI + cert verification).
  // HTTP: swap to IP literal so fetch connects to the validated IP.
  if (u.protocol === "https:") return { pinnedUrl: u, originalHost: original };
  const pinned = new URL(rawUrl);
  pinned.hostname = v === 6 ? `[${r.address}]` : r.address;
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
