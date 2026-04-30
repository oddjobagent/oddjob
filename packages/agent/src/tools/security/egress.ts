// Host-allowlist gate shared between web_fetch + web_search.
//
// When the surrounding environment has `networking.type === "limited"`, the
// agent loop passes the env's `allowedHosts` and the engine-required hosts
// (LLM base URL + MCP server hostnames) into the builtin tools. Both tools
// then refuse outbound calls to hosts outside the union of those two sets,
// mirroring the egress-proxy gate the session itself runs against. Without
// this, a tool that runs in the agent process (web_fetch, web_search) could
// reach arbitrary hosts even though the session it represents cannot.
//
// `envAllowedHosts === undefined` disables the gate entirely (env networking
// is `"open"` or unspecified).

import { hostMatches } from "@oddjob/core";

export interface EnvGateResult {
  allowed: boolean;
  /** Comma-separated summary suitable for an error message. */
  allowedSummary: string;
}

export function checkEnvAllowlist(
  host: string,
  envAllowedHosts: readonly string[] | undefined,
  engineRequiredHosts: readonly string[] | undefined,
): EnvGateResult {
  if (envAllowedHosts === undefined) {
    return { allowed: true, allowedSummary: "*" };
  }
  const all = [...envAllowedHosts, ...(engineRequiredHosts ?? [])];
  const summary = all.join(",") || "(empty)";
  return { allowed: hostMatches(host, all), allowedSummary: summary };
}
