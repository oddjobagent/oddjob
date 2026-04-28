import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { PluginRegistry, RoleResolver } from "@oddjob/core";
import type { AuthProvider, ConnectorTokenRecord } from "@oddjob/core";
import { LlmPiProvider } from "@oddjob/llm-pi";
import { LoggingSqliteProvider } from "@oddjob/logging-sqlite";
import { QueueSqliteProvider } from "@oddjob/queue-sqlite";
import { SecretsSqliteProvider } from "@oddjob/secrets-sqlite";
import { StateSqliteProvider } from "@oddjob/state-sqlite";

import { startServer } from "../server.ts";
import type { Runtime } from "../runtime.ts";

const FORBIDDEN_KEYS = [
  "accessTokenEncrypted",
  "refreshTokenEncrypted",
  "clientSecretEncrypted",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "tokenCiphertext",
];

const SECRET_VALUES = [
  "ENC-ACCESS-AAA",
  "ENC-REFRESH-BBB",
  "ENC-CLIENTSECRET-CCC",
  "PLAIN-ACCESS-DDD",
  "PLAIN-REFRESH-EEE",
];

let dir: string;
let runtime: Runtime;
let server: Awaited<ReturnType<typeof startServer>>;

function assertNoLeak(blob: string): void {
  for (const key of FORBIDDEN_KEYS) {
    expect(blob.includes(`"${key}"`)).toBe(false);
  }
  for (const v of SECRET_VALUES) {
    expect(blob.includes(v)).toBe(false);
  }
}

const stubAuth: AuthProvider = {
  name: "stub-auth",
  connect: async () => {},
  disconnect: async () => {},
  healthy: async () => true,
  getToken: async () => "PLAIN-ACCESS-DDD",
  status: async () => "authenticated",
  initiateFlow: async () => ({
    status: "authenticated",
    redirectUrl: "https://auth.example.com/oauth?x=1",
  }),
  refreshIfNeeded: async () => "PLAIN-ACCESS-DDD",
  revokeToken: async () => {},
};

const FIXTURE: ConnectorTokenRecord = {
  connectorId: "dep1:gmail",
  deploymentId: "dep1",
  connectorName: "gmail",
  accessTokenEncrypted: "iv1|ENC-ACCESS-AAA|tag1",
  refreshTokenEncrypted: "iv2|ENC-REFRESH-BBB|tag2",
  clientSecretEncrypted: "iv3|ENC-CLIENTSECRET-CCC|tag3",
  expiresAt: Date.now() + 3600_000,
  tokenUrl: "https://oauth.example.com/token",
  clientId: "client-pub-id",
  scopes: "read write",
  status: "active",
  updatedAt: Date.now(),
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-auth-api-"));
  const masterKey = Buffer.from("0".repeat(64), "hex");
  const state = new StateSqliteProvider({ path: join(dir, "s.db") });
  const queue = new QueueSqliteProvider({ path: join(dir, "q.db") });
  const secrets = new SecretsSqliteProvider({ path: join(dir, "sec.db"), masterKey });
  const log = new LoggingSqliteProvider({ path: join(dir, "l.db") });
  await Promise.all([state.connect(), queue.connect(), secrets.connect(), log.connect()]);
  await state.upsertConnectorToken(FIXTURE);

  const plugins = new PluginRegistry();
  const llm = new LlmPiProvider({ secrets });
  const roleResolver = new RoleResolver({
    registry: plugins,
    secrets,
    engineRoles: () => new Map(),
    credentials: () => new Map(),
    legacy: { resolve: (m, s) => llm.resolveModel(m, s) },
  });
  runtime = {
    state,
    queue,
    secrets,
    log,
    llm,
    plugins,
    roleResolver,
    auth: stubAuth,
    channelFor: () => undefined,
    config: {
      host: "127.0.0.1",
      port: 7791,
      maxWorkers: 1,
      leaseMs: 30_000,
      heartbeatMs: 5_000,
      pollMs: 200,
    },
  };
  server = await startServer({ runtime });
});

afterEach(async () => {
  await server.stop();
  await Promise.all([
    runtime.state.disconnect(),
    runtime.queue.disconnect(),
    runtime.secrets.disconnect(),
    runtime.log.disconnect(),
  ]);
  await rm(dir, { recursive: true, force: true });
});

describe("auth API token redaction", () => {
  test("GET /api/v1/auth/connectors does not leak ciphertext", async () => {
    const resp = await fetch(`${server.url}/api/v1/auth/connectors`);
    expect(resp.status).toBe(200);
    const text = await resp.text();
    assertNoLeak(text);
    const body = JSON.parse(text) as { tokens: Array<{ connectorId: string }> };
    expect(body.tokens[0]?.connectorId).toBe("dep1:gmail");
  });

  test("GET /api/v1/auth/connectors/:id does not leak ciphertext", async () => {
    const resp = await fetch(`${server.url}/api/v1/auth/connectors/dep1:gmail`);
    expect(resp.status).toBe(200);
    const text = await resp.text();
    assertNoLeak(text);
  });

  test("POST /api/v1/auth/connectors/initiate does not leak ciphertext", async () => {
    // Seed a blueprint + deployment so the route can resolve the connector.
    const bp = {
      id: "ns/bp",
      name: "bp",
      namespace: "ns",
      description: "",
      version: "1.0.0",
      schemaVersion: 1,
      author: "",
      tags: [],
      license: "",
      contentHash: "h",
      path: "fixture",
      model: "faux/echo",
      prompt: "",
      tools: [],
      skills: [],
      connectors: {
        gmail: {
          transport: "http",
          server: "https://example.com",
          auth: {
            kind: "oauth2",
            authorizationUrl: "https://auth.example.com/o",
            tokenUrl: "https://auth.example.com/token",
            clientIdRef: "CID",
          },
        },
      },
      scripts: {},
      memory: { store: "kv", retention: "30d" },
      secrets: {},
      failOnToolError: true,
    } as unknown as Parameters<typeof runtime.state.upsertBlueprint>[0];
    await runtime.state.upsertBlueprint(bp, { force: true });
    const dep = await runtime.state.createDeployment({
      name: "dep1",
      blueprintId: "ns/bp",
      triggers: [{ type: "manual" }],
      channels: [],
    });

    const resp = await fetch(`${server.url}/api/v1/auth/connectors/initiate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deploymentId: dep.id, connectorName: "gmail" }),
    });
    expect(resp.status).toBe(200);
    const text = await resp.text();
    assertNoLeak(text);
  });

  test("DELETE /api/v1/auth/connectors/:id does not leak ciphertext", async () => {
    const resp = await fetch(`${server.url}/api/v1/auth/connectors/dep1:gmail`, {
      method: "DELETE",
    });
    expect(resp.status).toBe(204);
    const text = await resp.text();
    assertNoLeak(text);
  });
});
