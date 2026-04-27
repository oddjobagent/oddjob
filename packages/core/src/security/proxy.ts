// Credential broker / egress proxy.
//
// Per-Run localhost proxy that the environment provider points the agent's
// HTTPS_PROXY at. Four jobs:
//
//   1. Allowlist gating — refuse any request whose target host is NOT in the
//      engine's required hosts ∪ the env's allowed_hosts. Returns 403 with a
//      clear reason; logs the denial. Gate is derived from the parsed
//      request URL (absolute-form OR resolved against Host header), NEVER
//      from the Host header alone — that closes the host-mismatch bypass.
//   2. Secret rewriting — agent code can put `${secret:NAME}` in headers /
//      bodies; the proxy substitutes the real value via SecretsProvider
//      BEFORE forwarding. The agent never sees the actual key. Cloudflare
//      AI Gateway pattern.
//   3. Token-shape scrubber — proxy inspects request bodies for known
//      vendor token shapes (sk-..., ghp_..., xoxb-..., dtn_...). On hit
//      → 422 + log. Belt-and-suspenders against env-dump exfil.
//   4. Per-run authentication — every request must carry the per-run
//      `Proxy-Authorization: Basic <token>` header (token is generated at
//      proxy-start and embedded in the URL passed to the session). Closes
//      the same-host port-scan exfil vector.
//
// HTTPS scope: this v1 cut handles HTTPS via raw CONNECT tunneling. The
// proxy gates on the CONNECT target host but cannot inspect the encrypted
// body (no MITM). For full body inspection a future revision can issue a
// per-Run CA + intercept TLS — out of scope for 15c.
//
// Plain-HTTP request body handling: bodies are buffered until Content-Length
// bytes arrive (or a 5s deadline elapses → 408). Transfer-Encoding: chunked
// is rejected with 411 — agents that need streaming should use HTTPS.

import { randomBytes } from "node:crypto";

import type { LogEntry, LogProvider } from "../providers/logging.ts";
import type { SecretsProvider } from "../providers/secrets.ts";

export interface EgressProxyOptions {
  /** Hosts allowed for egress. Unrestricted when set to `"*"`. */
  allowedHosts: readonly string[] | "*";
  /** Source for `${secret:NAME}` substitutions. */
  secrets?: SecretsProvider;
  /** Optional logging sink. Each gated request emits an entry. */
  onLog?: (entry: LogEntry) => void;
  /** Logging provider (alternative to onLog) — log() is called per request. */
  log?: { runId: string; provider: LogProvider };
  /** Whether to scan bodies for known vendor token shapes. Default true. */
  blockTokenShapes?: boolean;
  /** Cap on body size we attempt to rewrite (default 64 KiB). */
  maxRewritableBytes?: number;
  /** Cap on TOTAL forwarded body size for plain HTTP (default 1 MiB). */
  maxBodyBytes?: number;
  /** Body buffering deadline in ms (default 5000). */
  bodyDeadlineMs?: number;
}

export interface EgressProxyHandle {
  /** Proxy URL the session should be configured with (HTTPS_PROXY). */
  url: string;
  /** Per-run CA cert (empty for the v1 no-MITM cut; reserved for future). */
  caPem: string;
  /** Stop the proxy and close all in-flight connections. */
  stop(): Promise<void>;
}

const SECRET_PLACEHOLDER = /\$\{secret:([A-Za-z0-9_.-]+)\}/g;

const TOKEN_SHAPES: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "openai-sk", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  // GitHub: classic PAT (ghp_), fine-grained PAT (github_pat_), OAuth (gho_),
  // user-server (ghu_), server-server (ghs_), refresh (ghr_).
  { name: "github-pat", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { name: "github-pat-fine", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  // Slack: bot (xoxb-), user (xoxp-), app-level (xapp-), workflow (xwfp-).
  { name: "slack-token", re: /\b(?:xoxb|xoxp|xapp|xwfp)-[A-Za-z0-9-]{20,}\b/ },
  { name: "daytona", re: /\bdtn_[a-f0-9]{40,}\b/ },
  { name: "anthropic", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
];

/**
 * Start a per-Run egress proxy on 127.0.0.1:<random>. Returns the URL the
 * session should set as HTTPS_PROXY plus a `stop()` to release resources.
 *
 * The returned URL embeds a per-run Basic-auth credential (`oddjob:<token>`).
 * Session callers point clients at the embedded URL; the proxy enforces
 * `Proxy-Authorization: Basic ...` on every request and CONNECT.
 */
export async function startEgressProxy(opts: EgressProxyOptions): Promise<EgressProxyHandle> {
  const {
    allowedHosts,
    secrets,
    onLog,
    log,
    blockTokenShapes = true,
    maxRewritableBytes = 64 * 1024,
    maxBodyBytes = 1024 * 1024,
    bodyDeadlineMs = 5_000,
  } = opts;

  const isAllowed = makeAllowlist(allowedHosts);
  const emit = (entry: LogEntry): void => {
    onLog?.(entry);
    if (log) void log.provider.log(log.runId, entry);
  };
  // Per-socket cleanup handles. Each entry runs at most once on socket
  // close OR proxy.stop(); we track them so a chatty run doesn't
  // accumulate stale closures across thousands of sockets.
  const openHandles = new Map<import("bun").Socket<undefined>, () => void>();
  const registerHandle = (socket: import("bun").Socket<undefined>, cleanup: () => void): void => {
    openHandles.set(socket, cleanup);
  };
  const unregisterHandle = (socket: import("bun").Socket<undefined>): void => {
    openHandles.delete(socket);
  };

  // Per-run auth credential. Random 32 bytes → base64url. Embedded in the
  // returned proxy URL so the session injects it into Proxy-Authorization
  // automatically (curl, fetch, etc all do this).
  const token = randomBytes(32).toString("base64url");
  const expectedAuth = `Basic ${Buffer.from(`oddjob:${token}`).toString("base64")}`;

  // Per-client-socket state. Tracks whether we're parsing fresh headers,
  // buffering a body, in tunnel mode, or closed. Keeps client bytes that
  // arrive while CONNECT's upstream connect is pending in `pendingTunnelBuf`.
  type ClientState =
    | { kind: "fresh"; buf: Buffer }
    | {
        kind: "buffering";
        head: ParsedHead;
        bodyBuf: Buffer;
        bodyTimer?: ReturnType<typeof setTimeout>;
      }
    | { kind: "pending-tunnel"; pendingBytes: Buffer[] }
    | { kind: "tunnel"; upstream: import("bun").Socket<undefined> }
    | { kind: "closed" };
  const states = new WeakMap<import("bun").Socket<undefined>, ClientState>();
  const setState = (socket: import("bun").Socket<undefined>, state: ClientState): void => {
    states.set(socket, state);
  };

  const server = Bun.listen<undefined>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        setState(socket, { kind: "fresh", buf: Buffer.alloc(0) });
        registerHandle(socket, () => {
          try {
            socket.end();
          } catch {
            /* ignore */
          }
        });
      },
      data(socket, data) {
        const state = states.get(socket);
        if (!state) return;
        // Tunnel mode: forward bytes straight to upstream.
        if (state.kind === "tunnel") {
          try {
            state.upstream.write(data);
          } catch {
            /* upstream gone */
          }
          return;
        }
        // Pending-tunnel: queue bytes until upstream connects.
        if (state.kind === "pending-tunnel") {
          state.pendingBytes.push(data);
          return;
        }
        // Buffering body: accumulate until Content-Length matched.
        if (state.kind === "buffering") {
          state.bodyBuf = Buffer.concat([state.bodyBuf, data]);
          if (state.bodyBuf.length >= state.head.contentLength) {
            if (state.bodyTimer) clearTimeout(state.bodyTimer);
            const completeBody = state.bodyBuf.subarray(0, state.head.contentLength);
            setState(socket, { kind: "closed" });
            void handleHttp(socket, state.head, completeBody, {
              isAllowed,
              secrets,
              emit,
              blockTokenShapes,
              maxRewritableBytes,
            });
          }
          return;
        }
        if (state.kind === "closed") return;
        // Fresh: accumulate until end of headers.
        state.buf = Buffer.concat([state.buf, data]);
        const headerEnd = state.buf.indexOf("\r\n\r\n");
        if (headerEnd < 0) {
          // Cap header size to avoid memory exhaustion attacks.
          if (state.buf.length > 64 * 1024) {
            writeResponse(socket, 431, "headers too large");
            socket.end();
            setState(socket, { kind: "closed" });
          }
          return;
        }
        const headerBytes = state.buf.subarray(0, headerEnd);
        const tail = state.buf.subarray(headerEnd + 4);
        const head = parseHead(headerBytes);
        if (!head) {
          writeResponse(socket, 400, "bad request");
          socket.end();
          setState(socket, { kind: "closed" });
          return;
        }
        // Per-run auth.
        if (head.headers["proxy-authorization"] !== expectedAuth) {
          emit({
            timestamp: Date.now(),
            level: "warn",
            message: `egress denied (bad proxy auth): ${head.method} ${head.target}`,
          });
          writeResponse(socket, 407, "proxy authentication required");
          socket.end();
          setState(socket, { kind: "closed" });
          return;
        }
        // Reject chunked transfer (Bun.fetch handles it but our buffering
        // doesn't; agents needing streaming should use HTTPS).
        if (
          head.method !== "CONNECT" &&
          head.headers["transfer-encoding"]?.toLowerCase().includes("chunked")
        ) {
          writeResponse(socket, 411, "chunked transfer encoding not supported on this proxy");
          socket.end();
          setState(socket, { kind: "closed" });
          return;
        }
        if (head.method === "CONNECT") {
          // Allowlist gate on the CONNECT target host.
          const [chost, cport] = head.target.split(":");
          const port = cport ? Number(cport) : 443;
          if (!chost || !isAllowed(chost)) {
            emit({
              timestamp: Date.now(),
              level: "warn",
              message: `egress denied (CONNECT host not allowed): ${head.target}`,
              meta: { host: chost ?? "?", port },
            });
            writeResponse(socket, 403, `host '${chost ?? "?"}' not in egress allowlist`);
            socket.end();
            setState(socket, { kind: "closed" });
            return;
          }
          // Mark pending-tunnel and queue any extra client bytes.
          const pendingBytes: Buffer[] = tail.length > 0 ? [tail] : [];
          setState(socket, { kind: "pending-tunnel", pendingBytes });
          openTunnel(socket, chost, port, emit, registerHandle, (upstream) => {
            // Check the client is still pending — if it closed during the
            // upstream connect, drop the tunnel immediately rather than
            // writing 200 to a dead socket.
            const cur = states.get(socket);
            if (!cur || cur.kind === "closed") {
              try {
                upstream.end();
              } catch {
                /* ignore */
              }
              return;
            }
            // Replay queued bytes, then flip to tunnel mode.
            const queued = cur.kind === "pending-tunnel" ? cur.pendingBytes : [];
            setState(socket, { kind: "tunnel", upstream });
            try {
              socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            } catch {
              try {
                upstream.end();
              } catch {
                /* ignore */
              }
              return;
            }
            for (const chunk of queued) {
              try {
                upstream.write(chunk);
              } catch {
                /* upstream gone */
              }
            }
          });
          return;
        }
        // Plain HTTP. Gate on the URL's host (parsed below in handleHttp /
        // here we only need to start buffering the body).
        const contentLength = parseContentLength(head.headers["content-length"]);
        if (contentLength > maxBodyBytes) {
          writeResponse(socket, 413, `body exceeds ${maxBodyBytes} bytes`);
          socket.end();
          setState(socket, { kind: "closed" });
          return;
        }
        head.contentLength = contentLength;
        if (contentLength === 0 && tail.length === 0) {
          setState(socket, { kind: "closed" });
          void handleHttp(socket, head, Buffer.alloc(0), {
            isAllowed,
            secrets,
            emit,
            blockTokenShapes,
            maxRewritableBytes,
          });
          return;
        }
        // Start buffering the body up to contentLength bytes.
        const bodyBuf = tail.subarray(0, contentLength);
        if (bodyBuf.length >= contentLength) {
          setState(socket, { kind: "closed" });
          void handleHttp(socket, head, bodyBuf, {
            isAllowed,
            secrets,
            emit,
            blockTokenShapes,
            maxRewritableBytes,
          });
          return;
        }
        const bodyTimer = setTimeout(() => {
          const cur = states.get(socket);
          if (cur?.kind !== "buffering") return;
          if (cur.bodyTimer) clearTimeout(cur.bodyTimer);
          writeResponse(socket, 408, "request body timeout");
          socket.end();
          setState(socket, { kind: "closed" });
        }, bodyDeadlineMs);
        setState(socket, { kind: "buffering", head, bodyBuf, bodyTimer });
      },
      close(socket) {
        const state = states.get(socket);
        if (state?.kind === "tunnel") {
          try {
            state.upstream.end();
          } catch {
            /* ignore */
          }
        }
        if (state?.kind === "buffering" && state.bodyTimer) clearTimeout(state.bodyTimer);
        setState(socket, { kind: "closed" });
        unregisterHandle(socket);
      },
      error(_socket, error) {
        emit({
          timestamp: Date.now(),
          level: "warn",
          message: `egress proxy socket error: ${(error as Error).message}`,
        });
      },
    },
  });

  const port = server.port;
  emit({
    timestamp: Date.now(),
    level: "info",
    message: `egress proxy listening on 127.0.0.1:${port} (allowlist: ${
      allowedHosts === "*" ? "*" : (allowedHosts as readonly string[]).join(",")
    })`,
  });

  return {
    url: `http://oddjob:${token}@127.0.0.1:${port}`,
    caPem: "",
    async stop() {
      for (const cleanup of openHandles.values()) cleanup();
      openHandles.clear();
      server.stop(true);
    },
  };
}

interface ParsedHead {
  method: string;
  target: string;
  headers: Record<string, string>;
  contentLength: number;
}

function parseHead(headerBytes: Buffer): ParsedHead | undefined {
  const text = headerBytes.toString("latin1"); // ASCII headers; preserve bytes
  const lines = text.split("\r\n");
  const requestLine = lines[0];
  if (!requestLine) return undefined;
  const match = requestLine.match(/^(\S+)\s+(\S+)\s+HTTP\/\d\.\d$/);
  if (!match) return undefined;
  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const idx = lines[i]!.indexOf(":");
    if (idx < 0) continue;
    const name = lines[i]!.slice(0, idx).trim().toLowerCase();
    const value = lines[i]!.slice(idx + 1).trim();
    headers[name] = value;
  }
  return { method: match[1]!, target: match[2]!, headers, contentLength: 0 };
}

function parseContentLength(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

interface PlainHttpContext {
  isAllowed: (host: string) => boolean;
  secrets: SecretsProvider | undefined;
  emit: (entry: LogEntry) => void;
  blockTokenShapes: boolean;
  maxRewritableBytes: number;
}

async function handleHttp(
  socket: import("bun").Socket<undefined>,
  head: ParsedHead,
  body: Buffer,
  ctx: PlainHttpContext,
): Promise<void> {
  // Resolve the absolute target URL. Handles BOTH absolute-form
  // (`http://host/path`) and origin-form (`/path` + Host header).
  let targetUrl: URL;
  try {
    if (head.target.startsWith("http://") || head.target.startsWith("https://")) {
      targetUrl = new URL(head.target);
    } else {
      const host = head.headers.host;
      if (!host) {
        writeResponse(socket, 400, "missing host header");
        socket.end();
        return;
      }
      targetUrl = new URL(`http://${host}${head.target}`);
    }
  } catch {
    writeResponse(socket, 400, "bad request target");
    socket.end();
    return;
  }
  const gateHost = targetUrl.hostname;
  // CRITICAL: gate on the parsed URL's host, not the Host header — that
  // closes the host-mismatch bypass (client sends `GET http://disallowed/`
  // with `Host: allowed`, would have passed the old check).
  if (!ctx.isAllowed(gateHost)) {
    ctx.emit({
      timestamp: Date.now(),
      level: "warn",
      message: `egress denied (host not allowed): ${head.method} ${targetUrl.toString()}`,
      meta: { host: gateHost },
    });
    writeResponse(socket, 403, `host '${gateHost}' not in egress allowlist`);
    socket.end();
    return;
  }
  // Token-shape scan (BEFORE secret rewriting — catches raw vendor tokens
  // the agent shouldn't have seen in the first place). Try as utf8 even
  // for binary bodies; matches false-negative for non-text but doesn't
  // false-positive on random binary.
  if (ctx.blockTokenShapes && body.length > 0) {
    const bodyText = body.toString("utf8");
    const hit = scanTokenShapes(bodyText);
    if (hit) {
      ctx.emit({
        timestamp: Date.now(),
        level: "error",
        message: `egress blocked: body contains ${hit} token shape`,
        meta: { host: gateHost, method: head.method, url: targetUrl.toString(), shape: hit },
      });
      writeResponse(socket, 422, `body contains ${hit} token shape`);
      socket.end();
      return;
    }
  }
  // Secret rewriting on headers. Drop hop-by-hop + Proxy-Authorization +
  // Host BEFORE forwarding. The Host header MUST be set by Bun.fetch from
  // targetUrl, otherwise an attacker can spoof Host to bypass virtual-host
  // routing on the upstream (e.g. cloud allows `Host: allowed.example` to
  // hit a host that blocks `disallowed.example`). Also strip
  // proxy-authorization so we never leak our per-run token upstream.
  const forwardHeaders: Record<string, string> = {};
  const dropHeaders = new Set([
    "proxy-authorization",
    "proxy-connection",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "content-length",
    "upgrade",
    "host",
  ]);
  for (const [k, v] of Object.entries(head.headers)) {
    if (dropHeaders.has(k)) continue;
    forwardHeaders[k] = v;
  }
  const rewrittenHeaders = await rewriteRecord(forwardHeaders, ctx.secrets);
  // Rewrite body when small enough — over the cap we pass through but emit
  // a warning if it still contains placeholder syntax (likely bug).
  let rewrittenBody: Buffer | string = body;
  if (body.length > 0) {
    if (body.length <= ctx.maxRewritableBytes) {
      const text = body.toString("utf8");
      if (text.includes("${secret:")) {
        rewrittenBody = await rewriteString(text, ctx.secrets);
      }
    } else if (
      body.includes(Buffer.from("${secret:")) // cheap pre-check
    ) {
      ctx.emit({
        timestamp: Date.now(),
        level: "warn",
        message: `egress: body > ${ctx.maxRewritableBytes}B contains \${secret:...}, NOT rewritten`,
        meta: { host: gateHost, bytes: body.length },
      });
    }
  }

  try {
    const fetchBody: string | ArrayBuffer | undefined = ["GET", "HEAD"].includes(head.method)
      ? undefined
      : typeof rewrittenBody === "string"
        ? rewrittenBody
        : (rewrittenBody.buffer.slice(
            rewrittenBody.byteOffset,
            rewrittenBody.byteOffset + rewrittenBody.byteLength,
          ) as ArrayBuffer);
    const upstream = await fetch(targetUrl.toString(), {
      method: head.method,
      headers: rewrittenHeaders,
      body: fetchBody,
      redirect: "manual",
    });
    ctx.emit({
      timestamp: Date.now(),
      level: "info",
      message: `egress ${head.method} ${targetUrl.toString()} → ${upstream.status}`,
      meta: { host: gateHost, status: upstream.status },
    });
    const respBody = new Uint8Array(await upstream.arrayBuffer());
    writeRawResponse(socket, upstream.status, upstream.headers, respBody);
    socket.end();
  } catch (err) {
    ctx.emit({
      timestamp: Date.now(),
      level: "error",
      message: `egress upstream error ${head.method} ${targetUrl.toString()}: ${(err as Error).message}`,
    });
    writeResponse(socket, 502, `upstream: ${(err as Error).message}`);
    socket.end();
  }
}

function openTunnel(
  socket: import("bun").Socket<undefined>,
  host: string,
  port: number,
  emit: (entry: LogEntry) => void,
  registerHandle: (socket: import("bun").Socket<undefined>, cleanup: () => void) => void,
  onTunnelOpen: (upstream: import("bun").Socket<undefined>) => void,
): void {
  let upstreamRef: import("bun").Socket<undefined> | undefined;
  void Bun.connect({
    hostname: host,
    port,
    socket: {
      open(upstream) {
        upstreamRef = upstream as unknown as import("bun").Socket<undefined>;
        emit({
          timestamp: Date.now(),
          level: "info",
          message: `egress tunnel open ${host}:${port}`,
          meta: { host, port },
        });
        // Replace the per-socket cleanup so proxy.stop() also closes
        // the upstream tunnel when called mid-Run.
        registerHandle(socket, () => {
          try {
            socket.end();
          } catch {
            /* ignore */
          }
          try {
            upstream.end();
          } catch {
            /* ignore */
          }
        });
        onTunnelOpen(upstreamRef);
      },
      data(_upstream, bytes) {
        try {
          socket.write(bytes);
        } catch {
          /* client closed */
        }
      },
      close() {
        try {
          socket.end();
        } catch {
          /* ignore */
        }
      },
      error(_upstream, error) {
        emit({
          timestamp: Date.now(),
          level: "warn",
          message: `egress upstream error ${host}:${port}: ${(error as Error).message}`,
        });
        try {
          socket.end();
        } catch {
          /* ignore */
        }
      },
    },
  }).catch((err: Error) => {
    emit({
      timestamp: Date.now(),
      level: "warn",
      message: `egress connect failed ${host}:${port}: ${err.message}`,
    });
    writeResponse(socket, 502, `connect ${host}:${port}: ${err.message}`);
    socket.end();
  });
}

async function rewriteRecord(
  headers: Record<string, string>,
  secrets: SecretsProvider | undefined,
): Promise<Record<string, string>> {
  if (!secrets) return headers;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = await rewriteString(v, secrets);
  }
  return out;
}

async function rewriteString(s: string, secrets: SecretsProvider | undefined): Promise<string> {
  if (!secrets || !s.includes("${secret:")) return s;
  const names = new Set<string>();
  for (const m of s.matchAll(SECRET_PLACEHOLDER)) names.add(m[1]!);
  const resolved = new Map<string, string>();
  await Promise.all(
    [...names].map(async (n) => {
      const v = await secrets.get(n).catch(() => null);
      if (v != null) resolved.set(n, v);
    }),
  );
  return s.replace(SECRET_PLACEHOLDER, (_full, name: string) => resolved.get(name) ?? "");
}

function scanTokenShapes(body: string): string | undefined {
  for (const t of TOKEN_SHAPES) {
    if (t.re.test(body)) return t.name;
  }
  return undefined;
}

function makeAllowlist(allowed: readonly string[] | "*"): (host: string) => boolean {
  if (allowed === "*") return () => true;
  const exact = new Set(allowed);
  const wildcards = (allowed as readonly string[])
    .filter((h) => h.startsWith("*."))
    .map((h) => h.slice(2));
  return (host: string) => {
    if (exact.has(host)) return true;
    for (const suffix of wildcards) {
      if (host.endsWith(`.${suffix}`) || host === suffix) return true;
    }
    return false;
  };
}

function writeResponse(
  socket: import("bun").Socket<undefined>,
  status: number,
  reason: string,
): void {
  const body = `${status} ${reason}\n`;
  const head = [
    `HTTP/1.1 ${status} ${reason}`,
    "Content-Type: text/plain",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "Connection: close",
    "",
    "",
  ].join("\r\n");
  socket.write(head + body);
}

function writeRawResponse(
  socket: import("bun").Socket<undefined>,
  status: number,
  headers: Headers,
  body: Uint8Array,
): void {
  const lines: string[] = [`HTTP/1.1 ${status} ${statusText(status)}`];
  const skip = new Set([
    "connection",
    "keep-alive",
    "transfer-encoding",
    "content-length",
    "upgrade",
  ]);
  headers.forEach((value, name) => {
    if (skip.has(name.toLowerCase())) return;
    lines.push(`${name}: ${value}`);
  });
  lines.push(`Content-Length: ${body.byteLength}`);
  lines.push("Connection: close");
  lines.push("", "");
  socket.write(lines.join("\r\n"));
  socket.write(body);
}

function statusText(code: number): string {
  const map: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved Permanently",
    302: "Found",
    304: "Not Modified",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    407: "Proxy Authentication Required",
    408: "Request Timeout",
    411: "Length Required",
    413: "Payload Too Large",
    422: "Unprocessable Entity",
    431: "Request Header Fields Too Large",
    500: "Internal Server Error",
    502: "Bad Gateway",
  };
  return map[code] ?? "Unknown";
}
