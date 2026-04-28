import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { Connector } from "@oddjob/core";
import { open as openSealed } from "@oddjob/secrets-sqlite";
import { SecretsSqliteProvider } from "@oddjob/secrets-sqlite";
import { StateSqliteProvider } from "@oddjob/state-sqlite";

import { AuthLocalProvider } from "./provider.ts";

interface FakeServer {
  url: string;
  stop: () => Promise<void>;
  tokenCalls: Array<Record<string, string>>;
  /** Override token endpoint behaviour (e.g. omit refresh_token on 2nd call). */
  setTokenHandler: (fn: (body: Record<string, string>) => unknown | Promise<unknown>) => void;
  /** Override authorize endpoint behaviour (e.g. send wrong state). */
  setAuthHandler: (fn: (params: URLSearchParams) => { code?: string; state?: string }) => void;
}

function startFakeAuthServer(): FakeServer {
  const tokenCalls: Array<Record<string, string>> = [];
  let tokenHandler = (_body: Record<string, string>): unknown => ({
    access_token: "AT-1",
    refresh_token: "RT-1",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "read write",
  });
  let authHandler = (params: URLSearchParams): { code?: string; state?: string } => ({
    code: "fake_code",
    state: params.get("state") ?? "",
  });
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/auth") {
        const out = authHandler(url.searchParams);
        const redirect = url.searchParams.get("redirect_uri") ?? "/";
        const target = new URL(redirect);
        if (out.code !== undefined) target.searchParams.set("code", out.code);
        if (out.state !== undefined) target.searchParams.set("state", out.state);
        return new Response(null, { status: 302, headers: { location: target.toString() } });
      }
      if (url.pathname === "/token" && req.method === "POST") {
        const text = await req.text();
        const params = Object.fromEntries(new URLSearchParams(text).entries());
        tokenCalls.push(params);
        const out = tokenHandler(params);
        return new Response(JSON.stringify(out), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: async () => {
      server.stop(true);
    },
    tokenCalls,
    setTokenHandler: (fn) => {
      tokenHandler = fn as typeof tokenHandler;
    },
    setAuthHandler: (fn) => {
      authHandler = fn;
    },
  };
}

let dir: string;
let stateProv: StateSqliteProvider;
let secretsProv: SecretsSqliteProvider;
let provider: AuthLocalProvider;
let fake: FakeServer;
let masterKey: Buffer;

async function buildConnector(fakeUrl: string): Promise<Connector> {
  return {
    transport: "http",
    server: "https://example.com",
    auth: {
      kind: "oauth2",
      authorizationUrl: `${fakeUrl}/auth`,
      tokenUrl: `${fakeUrl}/token`,
      clientIdRef: "CID",
      clientSecretRef: "CSEC",
      scopes: ["read", "write"],
    },
  } as Connector;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-oauth-"));
  masterKey = Buffer.from("a".repeat(64), "hex");
  stateProv = new StateSqliteProvider({ path: join(dir, "state.db") });
  secretsProv = new SecretsSqliteProvider({ path: join(dir, "sec.db"), masterKey });
  await stateProv.connect();
  await secretsProv.connect();
  await secretsProv.set("CID", "client-id-fake");
  await secretsProv.set("CSEC", "client-secret-fake");
  fake = startFakeAuthServer();
  provider = new AuthLocalProvider({
    state: stateProv,
    secrets: secretsProv,
    masterKey,
    allowPrivateHosts: true,
  });
});

afterEach(async () => {
  await provider.disconnect();
  await fake.stop();
  await stateProv.disconnect();
  await secretsProv.disconnect();
  await rm(dir, { recursive: true, force: true });
});

/**
 * Helper: drive the OAuth flow to completion by hitting /auth on the fake server,
 * which 302s to the local callback, which exchanges the code on /token.
 */
async function driveFlow(redirectUrl: string): Promise<void> {
  const resp = await fetch(redirectUrl, { redirect: "manual" });
  expect(resp.status).toBe(302);
  const cb = resp.headers.get("location");
  expect(cb).toBeTruthy();
  // Hit the local callback URL (which is on http://127.0.0.1:<port>/oauth/callback).
  const r = await fetch(cb!);
  // Drain the response to ensure server has handled fully.
  await r.text();
}

describe("oauth flow end-to-end", () => {
  test("happy path: token exchange + persistence", async () => {
    const conn = await buildConnector(fake.url);
    const init = await provider.initiateFlow("dep1:my", conn);
    expect(init.redirectUrl).toBeDefined();

    await driveFlow(init.redirectUrl!);
    const rec = await provider.awaitCompletion("dep1:my", 5000);
    expect(rec.connectorId).toBe("dep1:my");
    expect(rec.status).toBe("active");
    expect(rec.expiresAt).toBeGreaterThan(Date.now());

    const persisted = await stateProv.getConnectorToken("dep1:my");
    expect(persisted).toBeTruthy();
    expect(persisted!.accessTokenEncrypted).toBeDefined();
    expect(persisted!.refreshTokenEncrypted).toBeDefined();
  });

  test("state mismatch: rejected, no token persisted", async () => {
    fake.setAuthHandler(() => ({ code: "fake_code", state: "BOGUS" }));
    const conn = await buildConnector(fake.url);
    const init = await provider.initiateFlow("dep1:bad", conn);
    await driveFlow(init.redirectUrl!);
    await expect(provider.awaitCompletion("dep1:bad", 2000)).rejects.toThrow(
      /state mismatch|no in-flight/,
    );
    const persisted = await stateProv.getConnectorToken("dep1:bad");
    expect(persisted).toBeNull();
  });

  test("PKCE: SHA256(code_verifier) === code_challenge sent to /auth", async () => {
    let challengeSent: string | null = null;
    fake.setAuthHandler((params) => {
      challengeSent = params.get("code_challenge");
      return { code: "fake_code", state: params.get("state") ?? "" };
    });
    const conn = await buildConnector(fake.url);
    const init = await provider.initiateFlow("dep1:pkce", conn);
    await driveFlow(init.redirectUrl!);
    await provider.awaitCompletion("dep1:pkce", 5000);

    const tokenCall = fake.tokenCalls[0];
    expect(tokenCall).toBeDefined();
    const verifier = tokenCall!.code_verifier;
    expect(verifier).toBeDefined();
    const computed = createHash("sha256").update(verifier!).digest("base64url");
    expect(computed).toBe(challengeSent!);
  });

  test("token AAD seal: wrong connectorId fails to decrypt", async () => {
    const conn = await buildConnector(fake.url);
    const init = await provider.initiateFlow("dep1:aad", conn);
    await driveFlow(init.redirectUrl!);
    await provider.awaitCompletion("dep1:aad", 5000);

    const persisted = await stateProv.getConnectorToken("dep1:aad");
    const blob = persisted!.accessTokenEncrypted;
    const [iv, ct, tag] = blob.split("|");
    expect(() =>
      openSealed(
        {
          iv: Buffer.from(iv!, "base64"),
          ciphertext: Buffer.from(ct!, "base64"),
          tag: Buffer.from(tag!, "base64"),
        },
        masterKey,
        { aad: "wrong:aad" },
      ),
    ).toThrow();
  });

  test("refresh preserves refresh_token when server omits it", async () => {
    const conn = await buildConnector(fake.url);
    const init = await provider.initiateFlow("dep1:rf", conn);
    await driveFlow(init.redirectUrl!);
    await provider.awaitCompletion("dep1:rf", 5000);

    const before = await stateProv.getConnectorToken("dep1:rf");
    const beforeRT = before!.refreshTokenEncrypted!;

    // Second token call returns no refresh_token.
    fake.setTokenHandler(() => ({
      access_token: "AT-2",
      token_type: "Bearer",
      expires_in: 7200,
    }));

    await provider.refreshIfNeeded("dep1:rf", { force: true });

    const after = await stateProv.getConnectorToken("dep1:rf");
    expect(after!.refreshTokenEncrypted).toBeDefined();
    // Same encrypted blob structure may differ (random IV), but plaintext must match.
    const beforeParts = beforeRT.split("|");
    const afterParts = after!.refreshTokenEncrypted!.split("|");
    const decBefore = openSealed(
      {
        iv: Buffer.from(beforeParts[0]!, "base64"),
        ciphertext: Buffer.from(beforeParts[1]!, "base64"),
        tag: Buffer.from(beforeParts[2]!, "base64"),
      },
      masterKey,
      { aad: "dep1:rf" },
    );
    const decAfter = openSealed(
      {
        iv: Buffer.from(afterParts[0]!, "base64"),
        ciphertext: Buffer.from(afterParts[1]!, "base64"),
        tag: Buffer.from(afterParts[2]!, "base64"),
      },
      masterKey,
      { aad: "dep1:rf" },
    );
    expect(decAfter).toBe(decBefore);
    expect(decAfter).toBe("RT-1");
  });
});
