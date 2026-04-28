// web_fetch builtin — dispatcher that resolves the configured WebFetchService
// plugin via the engine config (`[builtin_tools.web_fetch] plugin = "..."`),
// applies the SSRF guard at this layer (so all backends inherit it), then
// delegates the actual fetch.
//
// Defaults to plugin "raw" when registered. The "raw" backend is the
// Bun-native fetch + HTML→markdown lifted into @oddjob/plugin-web-fetch-core.

import type { Static } from "typebox";
import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import type { LogEntry } from "@oddjob/core";
import type { SecretsProvider } from "@oddjob/core";
import type { StateProvider } from "@oddjob/core";
import type { PluginRegistry } from "@oddjob/core";
import type { ProviderCredential } from "@oddjob/core";
import type { WebFetchConfig } from "./index.ts";
import { redactString } from "@oddjob/core";
import { checkEnvAllowlist } from "./env-egress.ts";
import { assertSafeUrl, SsrfBlockedError } from "./ssrf.ts";

const schema = Type.Object({
  url: Type.String({ description: "Absolute http(s) URL to fetch." }),
  format: Type.Optional(
    Type.Union([Type.Literal("markdown"), Type.Literal("text"), Type.Literal("raw")], {
      description: "Output format hint (raw passes through unchanged).",
    }),
  ),
});
type FetchInput = Static<typeof schema>;

interface FetchDetails {
  status: number;
  bytesIn: number;
  truncated: boolean;
  format: string;
  plugin: string;
}

export interface WebFetchToolOptions {
  config?: WebFetchConfig;
  onLog?: (entry: LogEntry) => void;
  fetchImpl?: typeof fetch;
  plugins?: PluginRegistry;
  secrets?: SecretsProvider;
  state?: StateProvider;
  /**
   * Hosts the surrounding env permits egress to. When defined (env networking
   * is `"limited"`), web_fetch refuses URLs whose host isn't in the union of
   * `envAllowedHosts ∪ engineRequiredHosts`. Undefined disables the gate.
   * The agent process itself can reach anything; this gate keeps it honest
   * with the egress proxy that limits the session's outbound traffic.
   */
  envAllowedHosts?: readonly string[];
  engineRequiredHosts?: readonly string[];
}

export function createWebFetchTool(opts: WebFetchToolOptions = {}): AgentTool<typeof schema> {
  const cfg = opts.config ?? {};
  const slug = cfg.plugin ?? "raw";
  const maxBytes = (cfg.maxBodyMb ?? 5) * 1024 * 1024;
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL via HTTPS and return the body. Backend chosen by [builtin_tools.web_fetch] plugin = ... (raw / browserbase / firecrawl / scrapingbee). SSRF-guarded.",
    parameters: schema,
    async execute(_id, params: FetchInput, signal): Promise<AgentToolResult<FetchDetails>> {
      const start = Date.now();
      // SSRF guard at dispatcher level so every backend inherits it.
      let safeUrl: string;
      let safeHost: string;
      try {
        const target = await assertSafeUrl(params.url, {
          privateIpsAllowed: cfg.privateIpsAllowed,
          allowlist: cfg.allowlist,
          blocklist: cfg.blocklist,
        });
        safeUrl = target.toString();
        safeHost = target.hostname;
      } catch (err) {
        if (err instanceof SsrfBlockedError) return errorResult(err.message, slug);
        return errorResult((err as Error).message ?? "ssrf check failed", slug);
      }

      // Env-egress gate: when the surrounding env is `"limited"`, the agent
      // process can technically reach anything but the env can't. Mirror the
      // proxy's allowlist here so web_fetch can't be used to bypass it.
      const envGate = checkEnvAllowlist(safeHost, opts.envAllowedHosts, opts.engineRequiredHosts);
      if (!envGate.allowed) {
        return errorResult(
          `host '${safeHost}' not in env egress allowlist (${envGate.allowedSummary})`,
          slug,
        );
      }

      if (!opts.plugins) {
        return errorResult(
          `web_fetch plugin registry unavailable; cannot dispatch '${slug}'`,
          slug,
        );
      }
      const svc = opts.plugins.webFetchFor(slug);
      if (!svc) {
        return errorResult(`web-fetch plugin '${slug}' not registered or disabled`, slug);
      }
      // Backend-capability gate. When the env declares limited networking
      // we MUST use a backend that honours per-hop validateUrl — otherwise
      // a managed scraper could follow redirects to a disallowed host
      // server-side, returning content from outside the allowlist. Backends
      // that omit `supportsRedirectValidation` default to false (safer).
      if (opts.envAllowedHosts !== undefined && svc.supportsRedirectValidation !== true) {
        return errorResult(
          `backend '${svc.id}' cannot enforce redirect validation; refused under limited-networking env`,
          slug,
        );
      }
      const credential = await materializeCredential(slug, opts.state, opts.secrets, cfg);
      // Per-hop validator passed to the fetch service. Plugins MUST call
      // this for every redirect Location target before following it. Closes
      // the redirect-bypass class (allowed.example → 302 → 169.254.169.254).
      const validateUrl = makeUrlValidator({
        ssrf: {
          privateIpsAllowed: cfg.privateIpsAllowed,
          allowlist: cfg.allowlist,
          blocklist: cfg.blocklist,
        },
        envAllowedHosts: opts.envAllowedHosts,
        engineRequiredHosts: opts.engineRequiredHosts,
      });
      try {
        const result = await svc.fetch(safeUrl, credential, {
          maxBytes,
          signal,
          fetchImpl: opts.fetchImpl,
          renderJs: cfg.renderJs,
          validateUrl,
        });
        // Post-hoc final-URL validation. Catches the case where a backend
        // honoured intermediate hops but the FINAL URL still landed somewhere
        // disallowed (e.g. a redirect within the same hop budget). Cheap to
        // rerun the validator against `result.finalUrl`. Backends without
        // redirect-validation support are already refused above for limited
        // env; this provides a final sanity check against open networking
        // when the backend's redirect handling is opaque.
        if (result.finalUrl && result.finalUrl !== safeUrl) {
          try {
            await validateUrl(result.finalUrl);
          } catch (vErr) {
            opts.onLog?.({
              timestamp: Date.now(),
              level: "error",
              message: `web_fetch ${svc.id} blocked at final URL ${redactString(result.finalUrl)}: ${(vErr as Error).message}`,
              meta: { durationMs: Date.now() - start },
            });
            return errorResult(
              `final URL rejected after fetch: ${(vErr as Error).message}`,
              svc.id,
            );
          }
        }
        opts.onLog?.({
          timestamp: Date.now(),
          level: result.status >= 400 ? "warn" : "info",
          message: `web_fetch ${svc.id} ${result.status} ${redactString(result.finalUrl)}`,
          meta: { durationMs: Date.now() - start, format: result.format },
        });
        const text = renderForOutput(result.body, result.format, params.format);
        const prefix = result.status >= 400 ? `[HTTP ${result.status}]\n` : "";
        return {
          content: [{ type: "text", text: prefix + text }],
          details: {
            status: result.status,
            bytesIn: text.length,
            truncated: result.truncated,
            format: result.format,
            plugin: svc.id,
          },
        };
      } catch (err) {
        return errorResult((err as Error).message ?? "fetch failed", svc.id);
      }
    },
  };
}

function errorResult(message: string, plugin: string): AgentToolResult<FetchDetails> {
  return {
    content: [{ type: "text", text: `web_fetch error: ${message}` }],
    details: { status: 0, bytesIn: 0, truncated: false, format: "text", plugin },
  };
}

function renderForOutput(
  body: string,
  serviceFormat: "markdown" | "html" | "text" | "json",
  hint?: "markdown" | "text" | "raw",
): string {
  if (hint === "raw") return body;
  if (hint === "text" && serviceFormat === "html") {
    return body
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return body;
}

interface UrlValidatorOpts {
  ssrf: {
    privateIpsAllowed?: boolean;
    allowlist?: readonly string[];
    blocklist?: readonly string[];
  };
  envAllowedHosts?: readonly string[];
  engineRequiredHosts?: readonly string[];
}

/**
 * Build a per-hop URL validator passed to the fetch service. Re-runs both
 * the SSRF guard AND the env-egress allowlist on every redirect target so a
 * 302 Location can't escape the dispatcher's pre-flight check.
 */
function makeUrlValidator(opts: UrlValidatorOpts): (url: string) => Promise<void> {
  return async (url: string) => {
    const target = await assertSafeUrl(url, opts.ssrf);
    const gate = checkEnvAllowlist(target.hostname, opts.envAllowedHosts, opts.engineRequiredHosts);
    if (!gate.allowed) {
      throw new SsrfBlockedError(
        `host '${target.hostname}' not in env egress allowlist (${gate.allowedSummary})`,
      );
    }
  };
}

async function materializeCredential(
  slug: string,
  state: StateProvider | undefined,
  secrets: SecretsProvider | undefined,
  cfg: WebFetchConfig | undefined,
): Promise<ProviderCredential> {
  let apiKey = cfg?.apiKey;
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
        } catch {
          // ignore malformed
        }
      }
    }
  }
  return { apiKey, options };
}
