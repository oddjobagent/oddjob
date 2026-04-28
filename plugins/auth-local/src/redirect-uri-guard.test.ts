import { describe, expect, test } from "bun:test";

import type { Connector, SecretsProvider, StateProvider } from "@oddjob/core";

import { AuthLocalProvider } from "./provider.ts";

const stubState = {} as unknown as StateProvider;
const stubSecrets = {
  get: async () => "client-id",
} as unknown as SecretsProvider;

function makeProvider(): AuthLocalProvider {
  return new AuthLocalProvider({
    state: stubState,
    secrets: stubSecrets,
    masterKey: Buffer.alloc(32),
  });
}

function connector(authUrl: string, tokenUrl: string): Connector {
  return {
    transport: "http",
    server: "https://example.com",
    auth: {
      kind: "oauth2",
      authorizationUrl: authUrl,
      tokenUrl,
      clientIdRef: "CID",
    },
  } as Connector;
}

describe("private-host guard in initiateFlow", () => {
  const cases = [
    "http://127.0.0.1/auth",
    "http://localhost:9000/auth",
    "http://[::1]/auth",
    "http://10.0.0.5/auth",
    "http://192.168.1.1/auth",
    "http://172.16.0.1/auth",
    "http://172.31.255.255/auth",
    "http://host.docker.internal/auth",
    "http://machine.local/auth",
    "http://service.internal/auth",
    "http://[fd00::1]/auth",
    "http://[fc00::abcd]/auth",
    "http://[fe80::1]/auth",
  ];
  for (const authUrl of cases) {
    test(`refuses ${authUrl}`, async () => {
      const p = makeProvider();
      await expect(
        p.initiateFlow("d:c", connector(authUrl, "https://ok.example.com/t")),
      ).rejects.toThrow(/private IP\/hostname/);
    });
  }

  test("refuses when only tokenUrl is private", async () => {
    const p = makeProvider();
    await expect(
      p.initiateFlow("d:c", connector("https://ok.example.com/auth", "http://10.0.0.1/token")),
    ).rejects.toThrow(/private IP\/hostname/);
  });

  test("172.x outside 16-31 range is allowed", async () => {
    const p = makeProvider();
    // 172.15 should pass the host check (will fail later due to no real network, but not on host check).
    let threwHostErr = false;
    try {
      await p.initiateFlow("d:c2", connector("http://172.15.0.1/auth", "https://ok.example.com/t"));
    } catch (e) {
      if (/private IP\/hostname/.test((e as Error).message)) threwHostErr = true;
    }
    expect(threwHostErr).toBe(false);
    await p.disconnect();
  });
});
