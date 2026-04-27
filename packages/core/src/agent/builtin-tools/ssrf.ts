import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const PRIVATE_V4_CIDRS: ReadonlyArray<readonly [number, number]> = [
  cidr("10.0.0.0", 8),
  cidr("172.16.0.0", 12),
  cidr("192.168.0.0", 16),
  cidr("127.0.0.0", 8),
  cidr("169.254.0.0", 16),
  cidr("100.64.0.0", 10),
  cidr("0.0.0.0", 8),
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

export interface SsrfGuardOptions {
  privateIpsAllowed?: boolean;
  allowlist?: readonly string[];
  blocklist?: readonly string[];
}

export class SsrfBlockedError extends Error {
  constructor(reason: string) {
    super(`refused outbound request: ${reason}`);
    this.name = "SsrfBlockedError";
  }
}

export async function assertSafeUrl(rawUrl: string, opts: SsrfGuardOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`invalid url: ${rawUrl}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SsrfBlockedError(`only http(s) allowed (got ${url.protocol})`);
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (opts.blocklist?.some((h) => hostMatches(hostname, h))) {
    throw new SsrfBlockedError(`blocklisted host: ${hostname}`);
  }
  if (opts.allowlist && !opts.allowlist.some((h) => hostMatches(hostname, h))) {
    throw new SsrfBlockedError(`host not in allowlist: ${hostname}`);
  }
  if (opts.privateIpsAllowed) return url;

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new SsrfBlockedError(`hostname '${hostname}' resolves to a private network`);
  }

  const ips: string[] = [];
  if (isIP(hostname)) {
    ips.push(hostname);
  } else {
    try {
      const records = await lookup(hostname, { all: true });
      for (const r of records) ips.push(r.address);
    } catch (err) {
      throw new SsrfBlockedError(`DNS lookup failed for ${hostname}: ${(err as Error).message}`);
    }
  }
  for (const ip of ips) {
    const v = isIP(ip);
    if (v === 4 && isPrivateV4(ip)) {
      throw new SsrfBlockedError(`${hostname} resolves to private IPv4 ${ip}`);
    }
    if (v === 6 && isPrivateV6(ip)) {
      throw new SsrfBlockedError(`${hostname} resolves to private IPv6 ${ip}`);
    }
  }
  return url;
}

function hostMatches(host: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  if (p.startsWith("*.")) return host === p.slice(2) || host.endsWith(p.slice(1));
  return host === p;
}

function cidr(network: string, bits: number): [number, number] {
  return [v4ToInt(network), bits];
}

function v4ToInt(ip: string): number {
  const parts = ip.split(".").map((n) => Number.parseInt(n, 10));
  return ((parts[0]! << 24) >>> 0) + ((parts[1]! << 16) >>> 0) + ((parts[2]! << 8) >>> 0) + parts[3]!;
}

function isPrivateV4(ip: string): boolean {
  const value = v4ToInt(ip);
  return PRIVATE_V4_CIDRS.some(([net, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) === (net & mask);
  });
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local fc00::/7
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice(7);
    return isIP(v4) === 4 ? isPrivateV4(v4) : false;
  }
  return false;
}
