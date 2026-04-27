// Shared hostname matcher. Used by:
//   - egress proxy allowlist (`packages/core/src/security/proxy.ts`)
//   - env-egress gate for web_fetch / web_search (`builtin-tools/env-egress.ts`)
//
// Hostnames are case-insensitive per RFC 1035 §2.3.3 — both `host` and the
// allowlist entries are lowercased before comparison so an agent can't bypass
// one gate by varying letter case.
//
// Wildcard syntax: `*.example.com` matches `foo.example.com`, `a.b.example.com`,
// AND the bare `example.com`. No other glob shapes (`?`, suffix, infix) are
// supported.

/**
 * Returns true when `host` matches any entry in `allow`. Both sides are
 * normalized to lowercase. `*.suffix` is the only wildcard shape recognised
 * and matches `suffix` itself plus any `.suffix` subdomain.
 */
export function hostMatches(host: string, allow: readonly string[]): boolean {
  const lower = host.toLowerCase();
  for (const entry of allow) {
    const e = entry.toLowerCase();
    if (e === lower) return true;
    if (e.startsWith("*.")) {
      const suffix = e.slice(2);
      if (lower === suffix || lower.endsWith(`.${suffix}`)) return true;
    }
  }
  return false;
}

/**
 * Curried variant — pre-compiles the allowlist once. Returns a constant-true
 * matcher when `allow` is the literal `"*"` (proxy's "unrestricted" sentinel).
 */
export function makeHostMatcher(allow: readonly string[] | "*"): (host: string) => boolean {
  if (allow === "*") return () => true;
  return (host: string) => hostMatches(host, allow);
}
