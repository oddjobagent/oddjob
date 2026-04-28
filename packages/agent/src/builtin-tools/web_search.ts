// web_search builtin — dispatcher that resolves the configured WebSearchService
// plugin via the engine config (`[builtin_tools.web_search] plugin = "..."`),
// materializes credentials from `provider_credentials`, and delegates the
// actual search call.

import type { Static } from "typebox";
import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import type { LogEntry } from "@oddjob/core";
import type { SecretsProvider } from "@oddjob/core";
import type { StateProvider } from "@oddjob/core";
import type { PluginRegistry } from "@oddjob/core";
import type { ProviderCredential, WebSearchResult } from "@oddjob/core";
import type { WebSearchConfig } from "./index.ts";
import { checkEnvAllowlist } from "./env-egress.ts";

const schema = Type.Object({
  query: Type.String({ description: "Search query." }),
  max_results: Type.Optional(Type.Number({ description: "Max results (default: 10)." })),
});
type SearchInput = Static<typeof schema>;

interface SearchDetails {
  provider: string;
  resultCount: number;
}

export interface WebSearchToolOptions {
  config?: WebSearchConfig;
  onLog?: (entry: LogEntry) => void;
  fetchImpl?: typeof fetch;
  plugins?: PluginRegistry;
  secrets?: SecretsProvider;
  state?: StateProvider;
  /**
   * Hosts the surrounding env permits egress to. When defined (env networking
   * is `"limited"`), web_search refuses to dispatch to a provider whose base
   * URL host isn't in `envAllowedHosts ∪ engineRequiredHosts`. Undefined
   * disables the gate.
   */
  envAllowedHosts?: readonly string[];
  engineRequiredHosts?: readonly string[];
}

export function createWebSearchTool(opts: WebSearchToolOptions = {}): AgentTool<typeof schema> {
  const cfg = opts.config;
  return {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web. Returns title, URL, and snippet for the top results. Provider chosen by [builtin_tools.web_search] plugin = ... (brave / tavily / searxng / exa / serpapi).",
    parameters: schema,
    async execute(_id, params: SearchInput, signal): Promise<AgentToolResult<SearchDetails>> {
      const slug = cfg?.plugin ?? cfg?.provider;
      if (!slug) {
        return errorResult(
          "web_search not configured — set [builtin_tools.web_search] plugin = ... in ~/.oddjob/config.toml",
          "none",
        );
      }
      if (!opts.plugins) {
        return errorResult(
          `web_search plugin registry unavailable; cannot dispatch '${slug}'`,
          slug,
        );
      }
      const svc = opts.plugins.webSearchFor(slug);
      if (!svc) {
        return errorResult(`web-search plugin '${slug}' not registered or disabled`, slug);
      }
      const credential = await materializeCredential(slug, opts.state, opts.secrets, cfg);

      // Env-egress gate. Only runs when the surrounding env declares
      // `networking.type === "limited"` (signalled by `envAllowedHosts !==
      // undefined`). Asking the SERVICE to resolve the host means the gate
      // sees the EXACT hostname the provider's `search()` will hit, instead
      // of trusting `credential.baseUrl` (which providers may override
      // internally with a per-plugin default).
      if (opts.envAllowedHosts !== undefined) {
        const providerHost = svc.resolveHost(credential);
        if (!providerHost) {
          return errorResult(
            `cannot determine egress host for plugin '${slug}' — set baseUrl on the credential`,
            slug,
          );
        }
        const envGate = checkEnvAllowlist(
          providerHost,
          opts.envAllowedHosts,
          opts.engineRequiredHosts,
        );
        if (!envGate.allowed) {
          return errorResult(
            `provider host '${providerHost}' for plugin '${slug}' not in env egress allowlist (${envGate.allowedSummary})`,
            slug,
          );
        }
      }

      const start = Date.now();
      try {
        const results = await svc.search(params.query, credential, {
          maxResults: params.max_results ?? cfg?.maxResults ?? 10,
          signal,
          fetchImpl: opts.fetchImpl,
        });
        opts.onLog?.({
          timestamp: Date.now(),
          level: "info",
          message: `web_search ${svc.id} returned ${results.length} results`,
          meta: { durationMs: Date.now() - start, query: params.query },
        });
        return {
          content: [{ type: "text", text: formatResults(results) }],
          details: { provider: svc.id, resultCount: results.length },
        };
      } catch (err) {
        return errorResult((err as Error).message ?? "search failed", svc.id);
      }
    },
  };
}

function errorResult(message: string, provider: string): AgentToolResult<SearchDetails> {
  return {
    content: [{ type: "text", text: `web_search error: ${message}` }],
    details: { provider, resultCount: 0 },
  };
}

function formatResults(results: readonly WebSearchResult[]): string {
  if (results.length === 0) return "No results.";
  return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n");
}

/**
 * Look up the credential row for `<slug>:default` in `provider_credentials`,
 * resolve the secret, and merge with engine-config-supplied apiKey/baseUrl as
 * a fallback. Returns an empty credential if nothing is configured — the
 * service implementation will throw an auth error if it needs a key.
 */
async function materializeCredential(
  slug: string,
  state: StateProvider | undefined,
  secrets: SecretsProvider | undefined,
  cfg: WebSearchConfig | undefined,
): Promise<ProviderCredential> {
  let apiKey = cfg?.apiKey;
  let baseUrl = cfg?.baseUrl;
  let options: Record<string, unknown> | undefined;
  if (state) {
    const row = await state.getProviderCredential(slug, "default").catch(() => null);
    if (row) {
      if (row.apiKeySecret && secrets) {
        const v = await secrets.get(row.apiKeySecret);
        if (v) apiKey = v;
      }
      if (row.optionsJson) {
        try {
          options = JSON.parse(row.optionsJson) as Record<string, unknown>;
          if (typeof options?.baseUrl === "string") baseUrl = options.baseUrl;
        } catch {
          // ignore malformed
        }
      }
    }
  }
  return { apiKey, baseUrl, options };
}
