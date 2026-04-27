import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { SecretsProvider } from "../providers/secrets.ts";
import {
  assertSafeBindAddress,
  startEgressProxy,
  type EgressProxyHandle,
} from "./proxy.ts";

// Tiny in-memory secrets provider for the rewriter test.
function fakeSecrets(values: Record<string, string>): SecretsProvider {
  return {
    name: "fake",
    connect: async () => undefined,
    disconnect: async () => undefined,
    healthy: async () => true,
    list: async () => Object.keys(values),
    get: async (name: string) => values[name] ?? null,
    has: async (name: string) => name in values,
    set: async () => undefined,
    delete: async () => undefined,
  };
}

// Fake upstream HTTP server we can point the proxy at.
function startFakeUpstream(handler: (req: Request) => Response | Promise<Response>): {
  url: string;
  host: string;
  stop(): void;
} {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
  const url = `http://127.0.0.1:${server.port}`;
  return { url, host: `127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

describe("egress proxy — bindAddress (15i-2 codex blocker)", () => {
  test("default bindAddress is 127.0.0.1 and surfaces in returned URL", async () => {
    const proxy = await startEgressProxy({
      allowedHosts: ["example.com"],
      blockTokenShapes: false,
      allowedPorts: [],
    });
    try {
      // URL host (between @ and :) is 127.0.0.1.
      const u = new URL(proxy.url);
      expect(u.hostname).toBe("127.0.0.1");
    } finally {
      await proxy.stop();
    }
  });

  test("explicit bindAddress is honored end-to-end (URL + listening socket)", async () => {
    // Pick a non-loopback address the host has — every machine has 127.0.0.2
    // routed to loopback on Linux; on Mac, 127.0.0.1 always works. We assert
    // only that the URL reflects the bindAddress passed in, plus that we can
    // reach the proxy on it. This is the regression covering the Linux
    // docker-bridge scenario without requiring docker in the test env.
    const proxy = await startEgressProxy({
      allowedHosts: ["127.0.0.1"],
      blockTokenShapes: false,
      allowPrivateIps: true,
      allowedPorts: [],
      bindAddress: "127.0.0.1",
    });
    try {
      const u = new URL(proxy.url);
      expect(u.hostname).toBe("127.0.0.1");
      // Smoke-test reachability via the URL.
      const upstream = startFakeUpstream(() => new Response("ok"));
      try {
        const r = await fetch(upstream.url, { proxy: proxy.url });
        expect(r.status).toBe(200);
      } finally {
        upstream.stop();
      }
    } finally {
      await proxy.stop();
    }
  });
});

describe("assertSafeBindAddress (codex round-2 MED 2)", () => {
  test("accepts loopback", () => {
    expect(() => assertSafeBindAddress("127.0.0.1")).not.toThrow();
    expect(() => assertSafeBindAddress("127.0.0.5")).not.toThrow();
  });

  test("accepts RFC1918 (10/8, 172.16/12, 192.168/16)", () => {
    expect(() => assertSafeBindAddress("10.0.0.1")).not.toThrow();
    expect(() => assertSafeBindAddress("172.17.0.1")).not.toThrow(); // docker bridge
    expect(() => assertSafeBindAddress("192.168.1.1")).not.toThrow();
  });

  test("accepts IPv4 link-local but rejects cloud-metadata", () => {
    expect(() => assertSafeBindAddress("169.254.1.1")).not.toThrow();
    expect(() => assertSafeBindAddress("169.254.169.254")).toThrow(/cloud-metadata/);
  });

  test("rejects 0.0.0.0 (multi-tenant exposure)", () => {
    expect(() => assertSafeBindAddress("0.0.0.0")).toThrow(/every interface/);
  });

  test("rejects :: (IPv6 unspecified)", () => {
    expect(() => assertSafeBindAddress("::")).toThrow(/every interface/);
  });

  test("rejects public IPv4 addresses", () => {
    expect(() => assertSafeBindAddress("8.8.8.8")).toThrow(/refusing to bind/);
    expect(() => assertSafeBindAddress("203.0.113.1")).toThrow(/refusing to bind/);
  });

  test("rejects multicast / reserved", () => {
    expect(() => assertSafeBindAddress("224.0.0.1")).toThrow(/refusing to bind/);
    expect(() => assertSafeBindAddress("255.255.255.255")).toThrow(/refusing to bind/);
  });

  test("rejects CGNAT (100.64/10) — not the operator's host", () => {
    expect(() => assertSafeBindAddress("100.64.0.1")).toThrow(/refusing to bind/);
  });

  test("rejects garbage", () => {
    expect(() => assertSafeBindAddress("not-an-ip")).toThrow(/not a valid IP/);
    expect(() => assertSafeBindAddress("")).toThrow(/empty/);
  });

  test("startEgressProxy refuses to start with 0.0.0.0", async () => {
    await expect(
      startEgressProxy({
        allowedHosts: ["example.com"],
        bindAddress: "0.0.0.0",
      }),
    ).rejects.toThrow(/refusing to bind/);
  });
});

describe("egress proxy — host allowlist", () => {
  let proxy: EgressProxyHandle;
  let upstream: ReturnType<typeof startFakeUpstream>;

  beforeEach(async () => {
    upstream = startFakeUpstream(() => new Response("hello", { status: 200 }));
    // Allowlist only 127.0.0.1 (the upstream's host).
    proxy = await startEgressProxy({
      allowedHosts: ["127.0.0.1"],
      blockTokenShapes: false,
      allowPrivateIps: true,
      allowedPorts: [],
    });
  });

  afterEach(async () => {
    await proxy.stop();
    upstream.stop();
  });

  test("forwards requests to allowlisted hosts", async () => {
    const r = await fetch(upstream.url, { proxy: proxy.url });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("hello");
  });

  test("denies requests to unlisted hosts (403)", async () => {
    // example.com is not in the allowlist.
    const r = await fetch("http://example.com/", { proxy: proxy.url });
    expect(r.status).toBe(403);
    expect(await r.text()).toContain("not in egress allowlist");
  });
});

describe("egress proxy — wildcards", () => {
  let proxy: EgressProxyHandle;
  let upstream: ReturnType<typeof startFakeUpstream>;

  beforeEach(async () => {
    upstream = startFakeUpstream(() => new Response("ok"));
    proxy = await startEgressProxy({
      allowPrivateIps: true,
      allowedPorts: [],
      allowedHosts: ["*.local"],
      blockTokenShapes: false,
    });
  });

  afterEach(async () => {
    await proxy.stop();
    upstream.stop();
  });

  test("denies requests to a non-matching host", async () => {
    const r = await fetch(upstream.url, { proxy: proxy.url });
    // 127.0.0.1 doesn't match *.local
    expect(r.status).toBe(403);
  });
});

describe("egress proxy — secret rewriting", () => {
  let proxy: EgressProxyHandle;
  let upstream: ReturnType<typeof startFakeUpstream>;
  let receivedAuth = "";
  let receivedBody = "";

  beforeEach(async () => {
    receivedAuth = "";
    receivedBody = "";
    upstream = startFakeUpstream(async (req) => {
      receivedAuth = req.headers.get("authorization") ?? "";
      if (req.method === "POST") receivedBody = await req.text();
      return new Response("ok");
    });
    proxy = await startEgressProxy({
      allowPrivateIps: true,
      allowedPorts: [],
      allowedHosts: ["127.0.0.1"],
      secrets: fakeSecrets({ openai: "sk-real-secret-123", token: "tk-real" }),
      blockTokenShapes: false,
    });
  });

  afterEach(async () => {
    await proxy.stop();
    upstream.stop();
  });

  test("substitutes ${secret:NAME} placeholder in headers", async () => {
    await fetch(upstream.url, {
      proxy: proxy.url,
      headers: { authorization: "Bearer ${secret:openai}" },
    });
    expect(receivedAuth).toBe("Bearer sk-real-secret-123");
  });

  test("substitutes placeholder in plain JSON body", async () => {
    await fetch(upstream.url, {
      method: "POST",
      proxy: proxy.url,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "${secret:token}" }),
    });
    expect(receivedBody).toContain("tk-real");
    expect(receivedBody).not.toContain("${secret:");
  });

  test("missing secret resolves to empty string", async () => {
    await fetch(upstream.url, {
      proxy: proxy.url,
      headers: { authorization: "Bearer ${secret:nonexistent}" },
    });
    // HTTP normalizes header values by trimming trailing whitespace,
    // so "Bearer " arrives as "Bearer". Either way the placeholder is gone.
    expect(receivedAuth.replace(/\s+$/, "")).toBe("Bearer");
    expect(receivedAuth).not.toContain("${secret:");
  });
});

describe("egress proxy — token-shape scrubber", () => {
  let proxy: EgressProxyHandle;
  let upstream: ReturnType<typeof startFakeUpstream>;
  const denials: string[] = [];

  beforeEach(async () => {
    denials.length = 0;
    upstream = startFakeUpstream(() => new Response("should not see this"));
    proxy = await startEgressProxy({
      allowPrivateIps: true,
      allowedPorts: [],
      allowedHosts: ["127.0.0.1"],
      blockTokenShapes: true,
      onLog: (e) => {
        if (e.level === "error") denials.push(e.message);
      },
    });
  });

  afterEach(async () => {
    await proxy.stop();
    upstream.stop();
  });

  test("blocks bodies containing openai sk- tokens", async () => {
    const r = await fetch(upstream.url, {
      method: "POST",
      proxy: proxy.url,
      body: "exfil sk-test1234567890abcdef1234 here",
    });
    expect(r.status).toBe(422);
    expect(denials.length).toBe(1);
    expect(denials[0]).toContain("openai-sk");
  });

  test("blocks bodies containing github ghp_ tokens", async () => {
    const r = await fetch(upstream.url, {
      method: "POST",
      proxy: proxy.url,
      body: "ghp_abcdefghijklmnopqrstuvwxyz123456",
    });
    expect(r.status).toBe(422);
    expect(denials[0]).toContain("github-pat");
  });

  test("blocks bodies containing slack xoxb- tokens", async () => {
    const r = await fetch(upstream.url, {
      method: "POST",
      proxy: proxy.url,
      body: "xoxb-12345-67890-abcdefghijklmnopqr",
    });
    expect(r.status).toBe(422);
    expect(denials[0]).toContain("slack-token");
  });

  test("blocks bodies containing slack xoxp- (user) tokens", async () => {
    const r = await fetch(upstream.url, {
      method: "POST",
      proxy: proxy.url,
      body: "xoxp-12345-67890-abcdefghijklmnopqr",
    });
    expect(r.status).toBe(422);
    expect(denials[0]).toContain("slack-token");
  });

  test("blocks bodies containing fine-grained github_pat_ tokens", async () => {
    const r = await fetch(upstream.url, {
      method: "POST",
      proxy: proxy.url,
      body: "github_pat_abcdefghijklmnopqrstuvwx_1234567890",
    });
    expect(r.status).toBe(422);
    expect(denials[0]).toContain("github-pat-fine");
  });

  test("allows clean bodies through", async () => {
    const r = await fetch(upstream.url, {
      method: "POST",
      proxy: proxy.url,
      body: "completely benign content",
    });
    expect(r.status).toBe(200);
  });
});

describe("egress proxy — logging", () => {
  test("emits info log on allowed forward + warn log on denial", async () => {
    const upstream = startFakeUpstream(() => new Response("ok"));
    const logs: { level: string; message: string }[] = [];
    const proxy = await startEgressProxy({
      allowPrivateIps: true,
      allowedPorts: [],
      allowedHosts: ["127.0.0.1"],
      blockTokenShapes: false,
      onLog: (e) => logs.push({ level: e.level, message: e.message }),
    });
    try {
      await fetch(upstream.url, { proxy: proxy.url });
      await fetch("http://denied.example/", { proxy: proxy.url });
      const allowed = logs.filter((l) => l.message.includes("egress GET"));
      const denied = logs.filter((l) => l.message.includes("denied"));
      expect(allowed.length).toBeGreaterThan(0);
      expect(denied.length).toBeGreaterThan(0);
    } finally {
      await proxy.stop();
      upstream.stop();
    }
  });
});

describe("egress proxy — security hardening", () => {
  test("returns 407 when Proxy-Authorization is missing", async () => {
    const proxy = await startEgressProxy({
      allowPrivateIps: true,
      allowedPorts: [],
      allowedHosts: ["127.0.0.1"],
      blockTokenShapes: false,
    });
    try {
      // Strip the auth from proxy.url and try directly. Since fetch with
      // proxy: URL extracts userinfo into Proxy-Authorization automatically,
      // we use a raw socket to bypass that and verify the proxy enforces auth.
      const url = new URL(proxy.url);
      const socket = await Bun.connect({
        hostname: "127.0.0.1",
        port: Number(url.port),
        socket: { data() {}, open() {}, close() {}, error() {} },
      });
      const responseChunks: Buffer[] = [];
      // Re-listen with a temporary handler. (Bun doesn't allow re-binding;
      // instead we just use a one-shot fetch via raw write.)
      socket.write("GET http://127.0.0.1/ HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
      // Wait briefly for the response.
      await new Promise((r) => setTimeout(r, 100));
      socket.end();
      // We can't easily read the response back via this minimal handler
      // structure; instead we observe the proxy's log entry as a signal.
      const logs: { level: string; message: string }[] = [];
      const proxy2 = await startEgressProxy({
        allowPrivateIps: true,
        allowedPorts: [],
        allowedHosts: ["127.0.0.1"],
        blockTokenShapes: false,
        onLog: (e) => logs.push({ level: e.level, message: e.message }),
      });
      try {
        const url2 = new URL(proxy2.url);
        const socket2 = await Bun.connect({
          hostname: "127.0.0.1",
          port: Number(url2.port),
          socket: {
            data(_s, d) {
              responseChunks.push(Buffer.from(d));
            },
            open(s) {
              s.write("GET http://127.0.0.1/ HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
            },
            close() {},
            error() {},
          },
        });
        await new Promise((r) => setTimeout(r, 200));
        socket2.end();
        const text = Buffer.concat(responseChunks).toString("utf8");
        expect(text).toContain("407");
        expect(logs.some((l) => l.message.includes("bad proxy auth"))).toBe(true);
      } finally {
        await proxy2.stop();
      }
    } finally {
      await proxy.stop();
    }
  });

  test("URL-host bypass closed: rejects when target URL host is denied even if Host header is allowed", async () => {
    // The agent sends `GET http://denied.example/` with `Host: 127.0.0.1`.
    // Old impl gated on Host (allowed), new impl gates on the parsed URL
    // (denied) so 403 wins.
    const proxy = await startEgressProxy({
      allowPrivateIps: true,
      allowedPorts: [],
      allowedHosts: ["127.0.0.1"],
      blockTokenShapes: false,
    });
    try {
      // Bun's high-level fetch normalizes Host so we need a raw socket here.
      const url = new URL(proxy.url);
      const responseChunks: Buffer[] = [];
      const auth = `Basic ${Buffer.from(`${url.username}:${url.password}`).toString("base64")}`;
      const socket = await Bun.connect({
        hostname: "127.0.0.1",
        port: Number(url.port),
        socket: {
          data(_s, d) {
            responseChunks.push(Buffer.from(d));
          },
          open(s) {
            s.write(
              `GET http://denied.example/ HTTP/1.1\r\nHost: 127.0.0.1\r\nProxy-Authorization: ${auth}\r\n\r\n`,
            );
          },
          close() {},
          error() {},
        },
      });
      await new Promise((r) => setTimeout(r, 200));
      socket.end();
      const text = Buffer.concat(responseChunks).toString("utf8");
      expect(text).toContain("403");
      expect(text).toContain("denied.example");
    } finally {
      await proxy.stop();
    }
  });

  test("rejects Transfer-Encoding: chunked with 411", async () => {
    const proxy = await startEgressProxy({
      allowPrivateIps: true,
      allowedPorts: [],
      allowedHosts: ["127.0.0.1"],
      blockTokenShapes: false,
    });
    try {
      const url = new URL(proxy.url);
      const responseChunks: Buffer[] = [];
      const auth = `Basic ${Buffer.from(`${url.username}:${url.password}`).toString("base64")}`;
      const socket = await Bun.connect({
        hostname: "127.0.0.1",
        port: Number(url.port),
        socket: {
          data(_s, d) {
            responseChunks.push(Buffer.from(d));
          },
          open(s) {
            s.write(
              `POST http://127.0.0.1/ HTTP/1.1\r\nHost: 127.0.0.1\r\nProxy-Authorization: ${auth}\r\nTransfer-Encoding: chunked\r\n\r\n`,
            );
          },
          close() {},
          error() {},
        },
      });
      await new Promise((r) => setTimeout(r, 200));
      socket.end();
      const text = Buffer.concat(responseChunks).toString("utf8");
      expect(text).toContain("411");
      expect(text).toContain("chunked");
    } finally {
      await proxy.stop();
    }
  });
});

describe("egress proxy — Phase 15c follow-up hardening", () => {
  test("DNS rebinding: rebound IP rejected (cloud metadata)", async () => {
    const upstream = startFakeUpstream(() => new Response("hello"));
    const denials: string[] = [];
    const proxy = await startEgressProxy({
      allowedHosts: ["127.0.0.1"],
      blockTokenShapes: false,
      allowedPorts: [],
      // allowPrivateIps left false — production posture.
      resolveHost: async () => "169.254.169.254",
      onLog: (e) => {
        if (e.level === "error") denials.push(e.message);
      },
    });
    try {
      const r = await fetch(upstream.url, { proxy: proxy.url });
      expect(r.status).toBe(403);
      expect(await r.text()).toContain("resolved ip rejected");
      expect(denials.some((m) => m.includes("cloud-metadata"))).toBe(true);
    } finally {
      await proxy.stop();
      upstream.stop();
    }
  });

  test("DNS rebinding: RFC1918 rejected", async () => {
    const upstream = startFakeUpstream(() => new Response("hello"));
    const proxy = await startEgressProxy({
      allowedHosts: ["allowed.example"],
      blockTokenShapes: false,
      allowedPorts: [],
      resolveHost: async () => "10.0.0.5",
      onLog: () => {},
    });
    try {
      const r = await fetch("http://allowed.example/", { proxy: proxy.url });
      expect(r.status).toBe(403);
      expect(await r.text()).toContain("rfc1918-10");
    } finally {
      await proxy.stop();
      upstream.stop();
    }
  });

  test("response body scrub: upstream returning sk- token blocked with 422", async () => {
    const upstream = startFakeUpstream(
      () => new Response("here you go: sk-leaked1234567890abcdef1234"),
    );
    const proxy = await startEgressProxy({
      allowedHosts: ["127.0.0.1"],
      blockTokenShapes: true,
      allowedPorts: [],
      allowPrivateIps: true,
    });
    try {
      const r = await fetch(upstream.url, { proxy: proxy.url });
      expect(r.status).toBe(422);
      expect(await r.text()).toContain("response body contains");
    } finally {
      await proxy.stop();
      upstream.stop();
    }
  });

  test("rewrite-then-scrub: ${secret:NAME} resolving to vendor token IS blocked", async () => {
    const upstream = startFakeUpstream(() => new Response("ok"));
    const proxy = await startEgressProxy({
      allowedHosts: ["127.0.0.1"],
      blockTokenShapes: true,
      allowedPorts: [],
      allowPrivateIps: true,
      secrets: fakeSecrets({ leaked: "sk-test1234567890abcdef1234" }),
    });
    try {
      const r = await fetch(upstream.url, {
        method: "POST",
        proxy: proxy.url,
        body: 'token = "${secret:leaked}"',
      });
      expect(r.status).toBe(422);
      expect(await r.text()).toContain("token shape");
    } finally {
      await proxy.stop();
      upstream.stop();
    }
  });

  test("URL token scan: sk- in query string rejected", async () => {
    const upstream = startFakeUpstream(() => new Response("hello"));
    const proxy = await startEgressProxy({
      allowedHosts: ["127.0.0.1"],
      blockTokenShapes: true,
      allowedPorts: [],
      allowPrivateIps: true,
    });
    try {
      const r = await fetch(`${upstream.url}/?token=sk-leaked1234567890abcdef`, {
        proxy: proxy.url,
      });
      expect(r.status).toBe(422);
      expect(await r.text()).toContain("url contains");
    } finally {
      await proxy.stop();
      upstream.stop();
    }
  });

  test("port allowlist: connect to non-allowed plain-HTTP port rejected", async () => {
    const upstream = startFakeUpstream(() => new Response("hello"));
    const proxy = await startEgressProxy({
      allowedHosts: ["127.0.0.1"],
      blockTokenShapes: false,
      allowedPorts: [80, 443], // upstream's random port not in list
      allowPrivateIps: true,
    });
    try {
      const r = await fetch(upstream.url, { proxy: proxy.url });
      expect(r.status).toBe(403);
      expect(await r.text()).toContain("port");
    } finally {
      await proxy.stop();
      upstream.stop();
    }
  });

  test("duplicate Host headers rejected with 400", async () => {
    const proxy = await startEgressProxy({
      allowedHosts: ["127.0.0.1"],
      blockTokenShapes: false,
      allowedPorts: [],
      allowPrivateIps: true,
    });
    try {
      const url = new URL(proxy.url);
      const auth = `Basic ${Buffer.from(`${url.username}:${url.password}`).toString("base64")}`;
      const responseChunks: Buffer[] = [];
      const socket = await Bun.connect({
        hostname: "127.0.0.1",
        port: Number(url.port),
        socket: {
          data(_s, d) {
            responseChunks.push(Buffer.from(d));
          },
          open(s) {
            s.write(
              `GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nHost: evil.example\r\nProxy-Authorization: ${auth}\r\n\r\n`,
            );
          },
          close() {},
          error() {},
        },
      });
      await new Promise((r) => setTimeout(r, 200));
      socket.end();
      const text = Buffer.concat(responseChunks).toString("utf8");
      expect(text).toContain("400");
      expect(text.toLowerCase()).toContain("host");
    } finally {
      await proxy.stop();
    }
  });

  test("log redaction: vendor tokens replaced with [REDACTED] in log lines", async () => {
    const upstream = startFakeUpstream(() => new Response("ok"));
    const logs: string[] = [];
    const proxy = await startEgressProxy({
      allowedHosts: ["allowed.example"], // upstream is 127.0.0.1 → denied
      blockTokenShapes: true,
      allowedPorts: [],
      allowPrivateIps: true,
      onLog: (e) => logs.push(e.message),
    });
    try {
      await fetch(`${upstream.url}/?token=sk-leaked1234567890abcdef`, {
        proxy: proxy.url,
      });
      const allLogs = logs.join("\n");
      expect(allLogs).toContain("[REDACTED]");
      expect(allLogs).not.toContain("sk-leaked1234567890abcdef");
    } finally {
      await proxy.stop();
      upstream.stop();
    }
  });
});

describe("egress proxy — production-posture inverse", () => {
  test("default allowPrivateIps=false: CONNECT to 127.0.0.1 rejected with loopback reason", async () => {
    // No allowPrivateIps override + no allowedPorts override → defaults
    // (allowPrivateIps=false, allowedPorts=[80,443]). 127.0.0.1 is in the
    // host allowlist but the IP-pin should reject it as loopback.
    const denials: string[] = [];
    const proxy = await startEgressProxy({
      allowedHosts: ["127.0.0.1"],
      blockTokenShapes: false,
      onLog: (e) => {
        if (e.level === "error") denials.push(e.message);
      },
    });
    try {
      const url = new URL(proxy.url);
      const auth = `Basic ${Buffer.from(`${url.username}:${url.password}`).toString("base64")}`;
      const responseChunks: Buffer[] = [];
      const socket = await Bun.connect({
        hostname: "127.0.0.1",
        port: Number(url.port),
        socket: {
          data(_s, d) {
            responseChunks.push(Buffer.from(d));
          },
          open(s) {
            // CONNECT to 127.0.0.1:443 — host allowlisted, port allowlisted,
            // but the resolved IP is loopback so the production posture rejects.
            s.write(
              `CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\nProxy-Authorization: ${auth}\r\n\r\n`,
            );
          },
          close() {},
          error() {},
        },
      });
      await new Promise((r) => setTimeout(r, 200));
      socket.end();
      const text = Buffer.concat(responseChunks).toString("utf8");
      expect(text).toContain("403");
      expect(text).toContain("loopback");
      expect(denials.some((m) => m.includes("loopback"))).toBe(true);
    } finally {
      await proxy.stop();
    }
  });
});
