import { describe, expect, test } from "bun:test";

import type { Connector, ConnectorTokenRecord, SecretsProvider, StateProvider } from "@oddjob/core";

import { AuthLocalProvider } from "./provider.ts";

function memoryState(): StateProvider {
  const tokens = new Map<string, ConnectorTokenRecord>();
  const stub = {
    upsertConnectorToken: async (r: ConnectorTokenRecord) => {
      tokens.set(r.connectorId, r);
    },
    getConnectorToken: async (id: string) => tokens.get(id) ?? null,
    listConnectorTokens: async () => [...tokens.values()],
    deleteConnectorToken: async (id: string) => {
      tokens.delete(id);
    },
  } as unknown as StateProvider;
  return stub;
}

function memorySecrets(map: Record<string, string>): SecretsProvider {
  return {
    connect: async () => {},
    disconnect: async () => {},
    healthy: async () => true,
    name: "memory",
    get: async (k: string) => map[k],
    set: async () => {},
    delete: async () => {},
    list: async () => Object.keys(map),
  } as unknown as SecretsProvider;
}

function fakeConnector(authUrl: string, tokenUrl: string): Connector {
  return {
    transport: "http",
    server: "https://example.com",
    auth: {
      kind: "oauth2",
      authorizationUrl: authUrl,
      tokenUrl,
      clientIdRef: "CID",
      scopes: ["read"],
    },
  } as Connector;
}

describe("awaitCompletion timeout + teardown", () => {
  test("rejects after timeoutMs and tears down ephemeral server", async () => {
    const provider = new AuthLocalProvider({
      state: memoryState(),
      secrets: memorySecrets({ CID: "client-abc" }),
      masterKey: Buffer.alloc(32),
    });
    const c = fakeConnector("https://auth.example.com/auth", "https://auth.example.com/token");
    const initRes = await provider.initiateFlow("dep1:my-conn", c);
    expect(initRes.redirectUrl).toBeDefined();

    const pending = (
      provider as unknown as {
        pending: Map<string, { server: { listening: boolean }; port: number }>;
      }
    ).pending;
    const entry = pending.get("dep1:my-conn");
    expect(entry).toBeDefined();
    // Wait for the http.Server to bind. `.listen()` is async; poll briefly.
    for (let i = 0; i < 20 && !entry!.server.listening; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(entry!.server.listening).toBe(true);

    await expect(provider.awaitCompletion("dep1:my-conn", 50)).rejects.toThrow(/timeout/);

    expect(pending.has("dep1:my-conn")).toBe(false);
    expect(entry!.server.listening).toBe(false);

    await provider.disconnect();
  });

  test("resolves immediately with persisted record when no in-flight flow", async () => {
    const state = memoryState();
    const provider = new AuthLocalProvider({
      state,
      secrets: memorySecrets({}),
      masterKey: Buffer.alloc(32),
    });
    await state.upsertConnectorToken({
      connectorId: "dep1:c",
      deploymentId: "dep1",
      connectorName: "c",
      accessTokenEncrypted: "iv|ct|tag",
      status: "active",
      updatedAt: Date.now(),
    });
    const rec = await provider.awaitCompletion("dep1:c", 100);
    expect(rec.connectorId).toBe("dep1:c");
  });
});
