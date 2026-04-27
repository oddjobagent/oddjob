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

import type { LogEntry } from "../../providers/logging.ts";
import type { SecretsProvider } from "../../providers/secrets.ts";
import type { StateProvider } from "../../providers/state.ts";
import type { PluginRegistry } from "../../plugin/registry.ts";
import type { ProviderCredential } from "../../plugin/types.ts";
import type { WebFetchConfig } from "./index.ts";
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
      try {
        const target = await assertSafeUrl(params.url, {
          privateIpsAllowed: cfg.privateIpsAllowed,
          allowlist: cfg.allowlist,
          blocklist: cfg.blocklist,
        });
        safeUrl = target.toString();
      } catch (err) {
        if (err instanceof SsrfBlockedError) return errorResult(err.message, slug);
        return errorResult((err as Error).message ?? "ssrf check failed", slug);
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
      const credential = await materializeCredential(slug, opts.state, opts.secrets, cfg);
      try {
        const result = await svc.fetch(safeUrl, credential, {
          maxBytes,
          signal,
          fetchImpl: opts.fetchImpl,
          renderJs: cfg.renderJs,
        });
        opts.onLog?.({
          timestamp: Date.now(),
          level: result.status >= 400 ? "warn" : "info",
          message: `web_fetch ${svc.id} ${result.status} ${result.finalUrl}`,
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
