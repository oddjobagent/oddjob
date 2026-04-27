import type { Static } from "typebox";
import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import TurndownService from "turndown";

import type { LogEntry } from "../../providers/logging.ts";
import type { WebFetchConfig } from "./index.ts";
import { assertSafeUrl, SsrfBlockedError } from "./ssrf.ts";

const schema = Type.Object({
  url: Type.String({
    description: "Absolute http(s) URL to fetch.",
  }),
  format: Type.Optional(
    Type.Union([Type.Literal("markdown"), Type.Literal("text"), Type.Literal("raw")], {
      description: "Output format. Default: markdown for HTML, text otherwise.",
    }),
  ),
});
type FetchInput = Static<typeof schema>;

interface FetchDetails {
  status: number;
  contentType: string;
  bytesIn: number;
  truncated: boolean;
  redirects: number;
}

export interface WebFetchToolOptions {
  config?: WebFetchConfig;
  onLog?: (entry: LogEntry) => void;
  fetchImpl?: typeof fetch;
}

const MAX_REDIRECTS = 3;

export function createWebFetchTool(opts: WebFetchToolOptions = {}): AgentTool<typeof schema> {
  const cfg = opts.config ?? {};
  const maxBytes = (cfg.maxBodyMb ?? 5) * 1024 * 1024;
  const fetchFn = opts.fetchImpl ?? fetch;
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL via HTTPS and return the body (HTML rendered to markdown by default). Refuses private/localhost addresses unless explicitly enabled.",
    parameters: schema,
    async execute(_id, params: FetchInput, signal): Promise<AgentToolResult<FetchDetails>> {
      const start = Date.now();
      try {
        let target = await assertSafeUrl(params.url, {
          privateIpsAllowed: cfg.privateIpsAllowed,
          allowlist: cfg.allowlist,
          blocklist: cfg.blocklist,
        });
        let redirects = 0;
        let resp: Response;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          resp = await fetchFn(target.toString(), {
            method: "GET",
            redirect: "manual",
            signal,
            headers: { "user-agent": "oddjob-web-fetch/0.1" },
          });
          if (resp.status >= 300 && resp.status < 400 && resp.headers.has("location")) {
            if (redirects >= MAX_REDIRECTS) {
              return errorResult(`too many redirects (>${MAX_REDIRECTS})`);
            }
            const next = new URL(resp.headers.get("location")!, target);
            target = await assertSafeUrl(next.toString(), {
              privateIpsAllowed: cfg.privateIpsAllowed,
              allowlist: cfg.allowlist,
              blocklist: cfg.blocklist,
            });
            redirects++;
            continue;
          }
          break;
        }
        const status = resp.status;
        const contentType = (resp.headers.get("content-type") ?? "").toLowerCase();
        const { body, bytes, truncated } = await readCapped(resp, maxBytes);
        const fmt = params.format ?? (contentType.includes("text/html") ? "markdown" : "text");
        const text = renderBody(body, contentType, fmt);
        opts.onLog?.({
          timestamp: Date.now(),
          level: status >= 400 ? "warn" : "info",
          message: `web_fetch ${status} ${target.toString()}`,
          meta: { bytes, redirects, durationMs: Date.now() - start },
        });
        const prefix = status >= 400 ? `[HTTP ${status}]\n` : "";
        return {
          content: [{ type: "text", text: prefix + text }],
          details: { status, contentType, bytesIn: bytes, truncated, redirects },
        };
      } catch (err) {
        if (err instanceof SsrfBlockedError) return errorResult(err.message);
        return errorResult((err as Error).message ?? "fetch failed");
      }
    },
  };
}

function errorResult(message: string): AgentToolResult<FetchDetails> {
  return {
    content: [{ type: "text", text: `web_fetch error: ${message}` }],
    details: { status: 0, contentType: "", bytesIn: 0, truncated: false, redirects: 0 },
  };
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

function renderBody(
  body: string,
  contentType: string,
  format: "markdown" | "text" | "raw",
): string {
  if (format === "raw") return body;
  if (format === "markdown" && contentType.includes("text/html")) {
    const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    return td.turndown(body);
  }
  if (contentType.includes("application/json")) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}
