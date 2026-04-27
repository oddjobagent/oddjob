// Egress proxy / credential broker.
//
// Per-Run localhost proxy that the environment provider points the agent's
// HTTPS_PROXY at. Two distinct security postures depending on transport:
//
// HTTPS (CONNECT tunneling) — works for ~all real API traffic:
//   - Per-run authentication (Proxy-Authorization Basic token).
//   - Allowlist gate on CONNECT target host with DNS-resolution + IP-pin
//     at allowlist-check time; rejects RFC1918 / loopback / link-local /
//     169.254.169.254 (cloud metadata).
//   - Port allowlist (default 443 only; 80 also allowed for plain HTTP).
//   - Outbound logging: each tunnel open recorded for audit.
//   - The encrypted body passes through opaque — proxy CANNOT see secrets,
//     scan bodies, or rewrite headers inside the TLS stream. This means
//     `${secret:NAME}` placeholders sent over HTTPS reach upstream LITERALLY.
//     Body inspection requires TLS termination + per-Run CA, deferred to v1.1.
//
// Plain HTTP — full inspection (rare in practice; documented as optional):
//   - Auth, allowlist, DNS-pin, port-allowlist (same as HTTPS).
//   - `${secret:NAME}` rewriting in headers + body (rewrite first).
//   - Token-shape scrubber on rewritten request body AND on response body
//     (so even a rewritten secret can't echo back through an allowed host).
//   - URL token scan (catch sk-/ghp_/etc in path or query).
//   - Log redaction: bearer values logged as `<present>`, URLs scrubbed.
//
// What the v1 broker does NOT do:
//   - Secret-injection over HTTPS (needs MITM; defer to v1.1).
//   - Block raw socket calls bypassing HTTPS_PROXY (needs OS-level netns;
//     local-strict / docker / remote-vm providers' job).
//
// Sandbox env continues to receive credentials via process env vars, as
// before. The broker today is a per-run egress firewall + audit log + plain-
// HTTP credential proxy. See docs/SECURITY.md for the threat model.
//
// Plain-HTTP request body handling: bodies are buffered until Content-Length
// bytes arrive (or a 5s deadline elapses → 408). Transfer-Encoding: chunked
// is rejected with 411 — agents that need streaming should use HTTPS.

import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { LogEntry, LogProvider } from "../providers/logging.ts";
import type { SecretsProvider } from "../providers/secrets.ts";
import { makeHostMatcher } from "./host-match.ts";
import { redactString } from "./redact.ts";

// Re-exported for backwards compatibility — callers used to import from proxy.ts.
export { redactString, deepRedact } from "./redact.ts";

export interface EgressProxyOptions {
  /** Hosts allowed for egress. Unrestricted when set to `"*"`. */
  allowedHosts: readonly string[] | "*";
  /** Source for `${secret:NAME}` substitutions (plain HTTP only — v1 broker can't MITM HTTPS). */
  secrets?: SecretsProvider;
  /** Optional logging sink. Each gated request emits an entry. */
  onLog?: (entry: LogEntry) => void;
  /** Logging provider (alternative to onLog) — log() is called per request. */
  log?: { runId: string; provider: LogProvider };
  /** Whether to scan bodies for known vendor token shapes. Default true. */
  blockTokenShapes?: boolean;
  /** Cap on body size we attempt to rewrite (default 64 KiB). */
  maxRewritableBytes?: number;
  /** Cap on TOTAL forwarded request body size for plain HTTP (default 1 MiB). */
  maxBodyBytes?: number;
  /** Cap on response body size we buffer + return (default 8 MiB). */
  maxResponseBytes?: number;
  /** Body buffering deadline in ms (default 5000). */
  bodyDeadlineMs?: number;
  /** Allowlist of upstream ports (default [80, 443]). Empty array means any. */
  allowedPorts?: readonly number[];
  /** Cap on concurrent CONNECT tunnels (default 16). */
  maxConcurrentTunnels?: number;
  /**
   * Test seam: pluggable DNS resolver. Default uses `node:dns/promises.lookup`.
   * Returning a single IP per host. Tests override to simulate DNS rebinding.
   */
  resolveHost?: (host: string) => Promise<string>;
  /**
   * Test seam: when true, do NOT reject RFC1918 / loopback / link-local /
   * cloud-metadata IPs. Tests that point at a fake localhost upstream set
   * this. Default false (production).
   */
  allowPrivateIps?: boolean;
  /**
   * Address to bind the listening socket on. Defaults to `127.0.0.1`.
   *
   * Container tiers (env-docker on Linux) need the proxy reachable from the
   * docker bridge: 127.0.0.1 inside the container is the container itself,
   * and `host.docker.internal` resolves to the bridge gateway IP (typically
   * 172.17.0.1 on Linux Docker engine), so a proxy bound only on loopback
   * accepts no connections from the container. The provider supplies this
   * value via its optional `proxyBindAddress()` hook; the runtime forwards
   * it here.
   *
   * The returned `url` always uses the configured bindAddress as its
   * hostname. Per-Run Proxy-Auth still gates every request, so binding on a
   * non-loopback IP does not weaken authentication; it only widens the
   * accept set.
   */
  bindAddress?: string;
}

export interface EgressProxyHandle {
  /** Proxy URL the session should be configured with (HTTPS_PROXY). */
  url: string;
  /**
   * Per-run CA cert PEM. **Always empty in v1** — there's no MITM, so no
   * cert is issued. Reserved for v1.1 when TLS termination lands. Plugins
   * may use the empty value as a signal to skip NODE_EXTRA_CA_CERTS setup.
   */
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
    maxResponseBytes = 8 * 1024 * 1024,
    bodyDeadlineMs = 5_000,
    allowedPorts = [80, 443],
    maxConcurrentTunnels = 16,
    resolveHost = defaultResolveHost,
    allowPrivateIps = false,
    bindAddress = "127.0.0.1",
  } = opts;

  const isAllowed = makeAllowlist(allowedHosts);
  const portAllowed = makePortAllowlist(allowedPorts);
  const emit = (entry: LogEntry): void => {
    onLog?.(entry);
    if (log) void log.provider.log(log.runId, entry);
  };
  let activeTunnels = 0;
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
    hostname: bindAddress,
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
              portAllowed,
              secrets,
              emit,
              blockTokenShapes,
              maxRewritableBytes,
              maxResponseBytes,
              resolveHost,
              allowPrivateIps,
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
        // Reject duplicate Host headers (HTTP smuggling / desync vector).
        if (head.duplicateHost) {
          emit({
            timestamp: Date.now(),
            level: "warn",
            message: `egress denied (multiple Host headers): ${head.method} ${head.target}`,
          });
          writeResponse(socket, 400, "multiple host headers");
          socket.end();
          setState(socket, { kind: "closed" });
          return;
        }
        // Per-run auth.
        if (head.headers["proxy-authorization"] !== expectedAuth) {
          emit({
            timestamp: Date.now(),
            level: "warn",
            // Redact target — the agent could put a token in the path/query.
            message: `egress denied (bad proxy auth): ${head.method} ${redactString(head.target)}`,
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
          // Port allowlist (default 443/80; blocks SSH, SMTP, Redis, etc.).
          if (!portAllowed(port)) {
            emit({
              timestamp: Date.now(),
              level: "warn",
              message: `egress denied (CONNECT port not allowed): ${head.target}`,
              meta: { host: chost, port },
            });
            writeResponse(socket, 403, `port ${port} not in egress port allowlist`);
            socket.end();
            setState(socket, { kind: "closed" });
            return;
          }
          // Concurrency cap: prevents runaway tunnel counts per Run.
          if (activeTunnels >= maxConcurrentTunnels) {
            emit({
              timestamp: Date.now(),
              level: "warn",
              message: `egress denied (concurrent CONNECT cap ${maxConcurrentTunnels} reached): ${head.target}`,
              meta: { host: chost, port, activeTunnels },
            });
            writeResponse(socket, 429, `concurrent CONNECT cap reached`);
            socket.end();
            setState(socket, { kind: "closed" });
            return;
          }
          activeTunnels++;
          // Mark pending-tunnel and queue any extra client bytes.
          const pendingBytes: Buffer[] = tail.length > 0 ? [tail] : [];
          setState(socket, { kind: "pending-tunnel", pendingBytes });
          void openTunnel(
            socket,
            chost,
            port,
            emit,
            registerHandle,
            resolveHost,
            allowPrivateIps,
            () => {
              activeTunnels = Math.max(0, activeTunnels - 1);
            },
            (upstream) => {
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
            },
          );
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
            portAllowed,
            secrets,
            emit,
            blockTokenShapes,
            maxRewritableBytes,
            maxResponseBytes,
            resolveHost,
            allowPrivateIps,
          });
          return;
        }
        // Start buffering the body up to contentLength bytes.
        const bodyBuf = tail.subarray(0, contentLength);
        if (bodyBuf.length >= contentLength) {
          setState(socket, { kind: "closed" });
          void handleHttp(socket, head, bodyBuf, {
            isAllowed,
            portAllowed,
            secrets,
            emit,
            blockTokenShapes,
            maxRewritableBytes,
            maxResponseBytes,
            resolveHost,
            allowPrivateIps,
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
    message: `egress proxy listening on ${bindAddress}:${port} (allowlist: ${
      allowedHosts === "*" ? "*" : (allowedHosts as readonly string[]).join(",")
    })`,
  });

  return {
    url: `http://oddjob:${token}@${bindAddress}:${port}`,
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
  /** True when the request had multiple Host headers (HTTP smuggling vector). */
  duplicateHost: boolean;
}

function parseHead(headerBytes: Buffer): ParsedHead | undefined {
  const text = headerBytes.toString("latin1"); // ASCII headers; preserve bytes
  const lines = text.split("\r\n");
  const requestLine = lines[0];
  if (!requestLine) return undefined;
  const match = requestLine.match(/^(\S+)\s+(\S+)\s+HTTP\/\d\.\d$/);
  if (!match) return undefined;
  const headers: Record<string, string> = {};
  let hostCount = 0;
  for (let i = 1; i < lines.length; i++) {
    const idx = lines[i]!.indexOf(":");
    if (idx < 0) continue;
    const name = lines[i]!.slice(0, idx).trim().toLowerCase();
    const value = lines[i]!.slice(idx + 1).trim();
    if (name === "host") hostCount++;
    headers[name] = value;
  }
  return {
    method: match[1]!,
    target: match[2]!,
    headers,
    contentLength: 0,
    duplicateHost: hostCount > 1,
  };
}

function parseContentLength(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

interface PlainHttpContext {
  isAllowed: (host: string) => boolean;
  portAllowed: (port: number) => boolean;
  secrets: SecretsProvider | undefined;
  emit: (entry: LogEntry) => void;
  blockTokenShapes: boolean;
  maxRewritableBytes: number;
  maxResponseBytes: number;
  resolveHost: (host: string) => Promise<string>;
  allowPrivateIps: boolean;
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
  // Gate on parsed URL host, NOT the Host header.
  if (!ctx.isAllowed(gateHost)) {
    ctx.emit({
      timestamp: Date.now(),
      level: "warn",
      // Redact URL so a token in path/query doesn't end up in logs.
      message: `egress denied (host not allowed): ${head.method} ${redactString(targetUrl.toString())}`,
      meta: { host: gateHost },
    });
    writeResponse(socket, 403, `host '${gateHost}' not in egress allowlist`);
    socket.end();
    return;
  }
  // Port allowlist (default 80/443).
  const targetPort = targetUrl.port ? Number(targetUrl.port) : 80;
  if (!ctx.portAllowed(targetPort)) {
    ctx.emit({
      timestamp: Date.now(),
      level: "warn",
      message: `egress denied (port not allowed): ${head.method} ${redactString(targetUrl.toString())}`,
      meta: { host: gateHost, port: targetPort },
    });
    writeResponse(socket, 403, `port ${targetPort} not in egress port allowlist`);
    socket.end();
    return;
  }
  // URL token scan (catches `?token=sk-...` exfil before we ever forward).
  if (ctx.blockTokenShapes) {
    const urlHit = scanTokenShapes(targetUrl.pathname + targetUrl.search);
    if (urlHit) {
      ctx.emit({
        timestamp: Date.now(),
        level: "error",
        message: `egress blocked: URL contains ${urlHit} token shape`,
        meta: { host: gateHost, shape: urlHit },
      });
      writeResponse(socket, 422, `url contains ${urlHit} token shape`);
      socket.end();
      return;
    }
  }
  // DNS-resolve + IP-pin BEFORE forwarding. Closes DNS-rebinding (allowed
  // host could resolve to RFC1918 / cloud-metadata between our check and
  // fetch's own resolution).
  let pinnedIp: string;
  try {
    pinnedIp = await ctx.resolveHost(gateHost);
  } catch (err) {
    ctx.emit({
      timestamp: Date.now(),
      level: "warn",
      message: `egress DNS resolution failed ${gateHost}: ${(err as Error).message}`,
    });
    writeResponse(socket, 502, `dns resolution failed for ${gateHost}`);
    socket.end();
    return;
  }
  const ipReason = ctx.allowPrivateIps ? undefined : isPrivateOrSensitiveIP(pinnedIp);
  if (ipReason) {
    ctx.emit({
      timestamp: Date.now(),
      level: "error",
      message: `egress denied (resolved IP rejected: ${ipReason}) ${gateHost} → ${pinnedIp}`,
      meta: { host: gateHost, resolvedIp: pinnedIp, reason: ipReason },
    });
    writeResponse(socket, 403, `resolved ip rejected (${ipReason})`);
    socket.end();
    return;
  }
  // Drop hop-by-hop + Proxy-Authorization + Host BEFORE forwarding.
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
  // Rewrite headers FIRST. The header-shape scan runs against the rewritten
  // values too — even rewritten secrets shouldn't reach the wire if they
  // happen to match a vendor token format AND a deny-list applies.
  const rewrittenHeaders = await rewriteRecord(forwardHeaders, ctx.secrets);
  // Rewrite body when small enough. Order matters: rewrite first, THEN scrub
  // the rewritten bytes. The earlier order (scrub-then-rewrite) let
  // `${secret:openrouter}` pass the scrubber, then resolve to a real sk-...
  // token that bypassed the check entirely.
  let rewrittenBody: Buffer = body;
  if (body.length > 0 && body.length <= ctx.maxRewritableBytes && ctx.secrets) {
    const text = body.toString("utf8");
    if (text.includes("${secret:")) {
      const rewritten = await rewriteString(text, ctx.secrets);
      rewrittenBody = Buffer.from(rewritten, "utf8");
    }
  } else if (body.length > ctx.maxRewritableBytes && body.includes(Buffer.from("${secret:"))) {
    ctx.emit({
      timestamp: Date.now(),
      level: "warn",
      message: `egress: body > ${ctx.maxRewritableBytes}B contains \${secret:...}, NOT rewritten`,
      meta: { host: gateHost, bytes: body.length },
    });
  }
  // Token-shape scan AFTER rewriting. Catches both raw vendor tokens the
  // agent put in the body AND placeholder values that resolved to vendor
  // tokens (which should never leave the proxy unscanned).
  if (ctx.blockTokenShapes && rewrittenBody.length > 0) {
    const hit = scanTokenShapes(rewrittenBody.toString("utf8"));
    if (hit) {
      ctx.emit({
        timestamp: Date.now(),
        level: "error",
        message: `egress blocked: rewritten body contains ${hit} token shape`,
        meta: { host: gateHost, method: head.method, shape: hit },
      });
      writeResponse(socket, 422, `body contains ${hit} token shape`);
      socket.end();
      return;
    }
  }

  try {
    const fetchBody: string | ArrayBuffer | undefined = ["GET", "HEAD"].includes(head.method)
      ? undefined
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
    // Buffered read with size cap. Avoids unbounded memory growth on a
    // pathologically large response from an allowed host.
    const respBytesAll = await upstream.bytes();
    const truncated = respBytesAll.byteLength > ctx.maxResponseBytes;
    const respBytes = truncated ? respBytesAll.subarray(0, ctx.maxResponseBytes) : respBytesAll;
    // Response body scrub: catches the echo-endpoint exfil (agent POSTs a
    // secret to an allowed host that mirrors the request body back).
    if (ctx.blockTokenShapes && respBytes.byteLength > 0) {
      const respText = Buffer.from(respBytes).toString("utf8");
      const hit = scanTokenShapes(respText);
      if (hit) {
        ctx.emit({
          timestamp: Date.now(),
          level: "error",
          message: `egress blocked: response body contains ${hit} token shape`,
          meta: { host: gateHost, status: upstream.status, shape: hit },
        });
        writeResponse(socket, 422, `response body contains ${hit} token shape`);
        socket.end();
        return;
      }
    }
    ctx.emit({
      timestamp: Date.now(),
      level: "info",
      message: `egress ${head.method} ${redactString(targetUrl.toString())} → ${upstream.status}${truncated ? " (response truncated)" : ""}`,
      meta: { host: gateHost, status: upstream.status, bytes: respBytes.byteLength },
    });
    writeRawResponse(socket, upstream.status, upstream.headers, respBytes);
    socket.end();
  } catch (err) {
    ctx.emit({
      timestamp: Date.now(),
      level: "error",
      message: `egress upstream error ${head.method} ${redactString(targetUrl.toString())}: ${(err as Error).message}`,
    });
    writeResponse(socket, 502, `upstream: ${(err as Error).message}`);
    socket.end();
  }
}

async function openTunnel(
  socket: import("bun").Socket<undefined>,
  host: string,
  port: number,
  emit: (entry: LogEntry) => void,
  registerHandle: (socket: import("bun").Socket<undefined>, cleanup: () => void) => void,
  resolveHost: (host: string) => Promise<string>,
  allowPrivateIps: boolean,
  onClose: () => void,
  onTunnelOpen: (upstream: import("bun").Socket<undefined>) => void,
): Promise<void> {
  // DNS resolve + IP pin BEFORE connecting. Closes DNS-rebinding: an attacker
  // who controls allowed.example DNS could resolve to 169.254.169.254 (cloud
  // metadata) or RFC1918 between the allowlist check and Bun.connect's own
  // resolution. We resolve once, validate, and connect to the resolved IP.
  let pinnedIp: string;
  try {
    pinnedIp = await resolveHost(host);
  } catch (err) {
    emit({
      timestamp: Date.now(),
      level: "warn",
      message: `egress DNS resolution failed ${host}: ${(err as Error).message}`,
      meta: { host, port },
    });
    writeResponse(socket, 502, `dns resolution failed for ${host}`);
    socket.end();
    onClose();
    return;
  }
  const ipReason = allowPrivateIps ? undefined : isPrivateOrSensitiveIP(pinnedIp);
  if (ipReason) {
    emit({
      timestamp: Date.now(),
      level: "error",
      message: `egress denied (resolved IP rejected: ${ipReason}) ${host} → ${pinnedIp}`,
      meta: { host, resolvedIp: pinnedIp, port, reason: ipReason },
    });
    writeResponse(socket, 403, `resolved ip rejected (${ipReason})`);
    socket.end();
    onClose();
    return;
  }
  void Bun.connect({
    hostname: pinnedIp,
    port,
    socket: {
      open(upstream) {
        emit({
          timestamp: Date.now(),
          level: "info",
          message: `egress tunnel open ${host}:${port} (ip=${pinnedIp})`,
          meta: { host, port, resolvedIp: pinnedIp },
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
        onTunnelOpen(upstream as unknown as import("bun").Socket<undefined>);
      },
      data(_upstream, bytes) {
        try {
          socket.write(bytes);
        } catch {
          /* client closed */
        }
      },
      close() {
        onClose();
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
        onClose();
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
    onClose();
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
  // Hostnames are case-insensitive per RFC 1035; delegate to the shared
  // matcher so the proxy's allowlist behaves the same as the in-process
  // env-egress gate used by web_fetch / web_search.
  return makeHostMatcher(allowed);
}

function makePortAllowlist(allowed: readonly number[]): (port: number) => boolean {
  if (allowed.length === 0) return () => true;
  const set = new Set(allowed);
  return (port: number) => set.has(port);
}

async function defaultResolveHost(host: string): Promise<string> {
  // If host is already a literal IP, return it. Otherwise resolve once.
  if (isIP(host)) return host;
  const r = await lookup(host);
  return r.address;
}

/**
 * Returns a reason string when the IP should be rejected, otherwise undefined.
 * Catches RFC1918, loopback, link-local (incl. 169.254.169.254 cloud metadata),
 * IPv4-mapped private IPv6, and ULA. This closes the SSRF / DNS-rebinding /
 * cloud-metadata exfil class.
 */
export function isPrivateOrSensitiveIP(ip: string): string | undefined {
  // Cloud metadata endpoints (covered by link-local but called out explicitly).
  if (ip === "169.254.169.254" || ip === "fd00:ec2::254") return "cloud-metadata";
  if (ip === "::1" || ip === "127.0.0.1") return "loopback";
  // IPv4
  if (isIP(ip) === 4) {
    const octets = ip.split(".").map(Number);
    const [a, b] = octets;
    if (a === undefined || b === undefined) return undefined;
    if (a === 10) return "rfc1918-10";
    if (a === 127) return "loopback";
    if (a === 169 && b === 254) return "link-local";
    if (a === 172 && b >= 16 && b <= 31) return "rfc1918-172";
    if (a === 192 && b === 168) return "rfc1918-192";
    if (a === 100 && b >= 64 && b <= 127) return "cgnat";
    if (a === 0) return "this-network";
    if (a >= 224) return "multicast-or-reserved";
    return undefined;
  }
  // IPv6 — match common private/loopback/link-local prefixes.
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower.startsWith("fe80:")) return "ipv6-link-local";
    if (lower.startsWith("fc") || lower.startsWith("fd")) return "ipv6-ula";
    if (lower.startsWith("::ffff:")) {
      // IPv4-mapped — recurse on the embedded IPv4.
      const v4 = lower.slice("::ffff:".length);
      if (isIP(v4) === 4) return isPrivateOrSensitiveIP(v4);
    }
    return undefined;
  }
  return undefined;
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
    429: "Too Many Requests",
    431: "Request Header Fields Too Large",
    500: "Internal Server Error",
    502: "Bad Gateway",
  };
  return map[code] ?? "Unknown";
}
