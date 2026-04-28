import { describe, expect, test } from "bun:test";

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Connector, McpGetTokenFn, ToolCall } from "@oddjob/core";

import { McpClientSession, type McpClientFactory } from "./provider.ts";

interface FakeClientHandle {
  schedule: Array<401 | "ok">;
  callsMade: number;
  closed: boolean;
  client: Client;
}

function makeFakeClient(schedule: Array<401 | "ok">): FakeClientHandle {
  const handle: FakeClientHandle = {
    schedule,
    callsMade: 0,
    closed: false,
    client: undefined as unknown as Client,
  };
  handle.client = {
    async callTool() {
      const idx = handle.callsMade++;
      const next = handle.schedule[idx] ?? "ok";
      if (next === 401) {
        const e = new Error("HTTP 401 Unauthorized") as Error & { code: number };
        e.code = 401;
        throw e;
      }
      return {
        content: [{ type: "text", text: "ok" }],
        isError: false,
      };
    },
    async close() {
      handle.closed = true;
    },
  } as unknown as Client;
  return handle;
}

const oauthConnector: Connector = {
  transport: "http",
  server: "http://example.invalid/",
  auth: {
    kind: "oauth2",
    authorizationUrl: "http://example.invalid/auth",
    tokenUrl: "http://example.invalid/token",
    clientIdRef: "X",
  },
} as Connector;

const apiKeyConnector: Connector = {
  transport: "http",
  server: "http://example.invalid/",
  auth: { kind: "api_key", secretRef: "API_KEY", headerName: "X-Api-Key" },
} as Connector;

const sampleCall: ToolCall = { id: "1", name: "c__t", input: {} };
const constToken: McpGetTokenFn = async () => "token";

describe("McpClientSession 401 retry", () => {
  test("retry uses a freshly-built client (proving reconnect happened)", async () => {
    const first = makeFakeClient([401]);
    const second = makeFakeClient(["ok"]);
    let factoryCalls = 0;
    const factory: McpClientFactory = async () => {
      factoryCalls++;
      return second.client;
    };
    let forced = 0;
    const getToken: McpGetTokenFn = async (opts) => {
      if (opts?.forceRefresh) forced++;
      return "token";
    };
    const session = new McpClientSession(
      "c",
      first.client,
      oauthConnector,
      getToken,
      undefined,
      factory,
    );
    const result = await session.callTool(sampleCall);
    expect(result.isError).toBe(false);
    expect(result.content).toBe("ok");
    expect(first.callsMade).toBe(1);
    expect(first.closed).toBe(true);
    expect(second.callsMade).toBe(1);
    expect(factoryCalls).toBe(1);
    expect(forced).toBe(1);
  });

  test("refreshed token reaches the second client", async () => {
    const tokens: string[] = [];
    const tokenSeq = ["stale", "fresh"];
    let issued = 0;
    const getToken: McpGetTokenFn = async () => {
      const t = tokenSeq[issued] ?? "fresh";
      issued = Math.min(issued + 1, tokenSeq.length - 1);
      return t;
    };
    const first = makeFakeClient([401]);
    const second = makeFakeClient(["ok"]);
    const factory: McpClientFactory = async (_connector, getTok) => {
      const t = await getTok();
      tokens.push(t ?? "");
      return second.client;
    };
    const session = new McpClientSession(
      "c",
      first.client,
      oauthConnector,
      getToken,
      undefined,
      factory,
    );
    const result = await session.callTool(sampleCall);
    expect(result.isError).toBe(false);
    expect(tokens).toEqual(["fresh"]);
  });

  test("fires onReauthNeeded after two 401s and returns tool error", async () => {
    const first = makeFakeClient([401]);
    const second = makeFakeClient([401]);
    const factory: McpClientFactory = async () => second.client;
    const reauths: string[] = [];
    const session = new McpClientSession(
      "c",
      first.client,
      oauthConnector,
      constToken,
      {
        onReauthNeeded: (id) => {
          reauths.push(id);
        },
      },
      factory,
    );
    const result = await session.callTool(sampleCall);
    expect(result.isError).toBe(true);
    expect(first.callsMade).toBe(1);
    expect(second.callsMade).toBe(1);
    expect(reauths).toEqual(["c"]);
  });

  test("does not fire onReauthNeeded when no callback is supplied (just returns error)", async () => {
    const first = makeFakeClient([401]);
    const second = makeFakeClient([401]);
    const factory: McpClientFactory = async () => second.client;
    const session = new McpClientSession(
      "c",
      first.client,
      oauthConnector,
      constToken,
      undefined,
      factory,
    );
    const result = await session.callTool(sampleCall);
    expect(result.isError).toBe(true);
    expect(first.callsMade).toBe(1);
    expect(second.callsMade).toBe(1);
  });

  test("does not retry for non-oauth2 connectors", async () => {
    const first = makeFakeClient([401]);
    let factoryCalls = 0;
    const factory: McpClientFactory = async () => {
      factoryCalls++;
      return makeFakeClient(["ok"]).client;
    };
    let reauthFired = false;
    const session = new McpClientSession(
      "c",
      first.client,
      apiKeyConnector,
      constToken,
      {
        onReauthNeeded: () => {
          reauthFired = true;
        },
      },
      factory,
    );
    const result = await session.callTool(sampleCall);
    expect(result.isError).toBe(true);
    expect(first.callsMade).toBe(1);
    expect(factoryCalls).toBe(0);
    expect(reauthFired).toBe(false);
  });

  test("does not treat non-401 errors as auth failures", async () => {
    let callsMade = 0;
    const fake = {
      async callTool() {
        callsMade++;
        const e = new Error("rate limited") as Error & { code: number };
        e.code = 429;
        throw e;
      },
      async close() {},
    } as unknown as Client;
    let factoryCalls = 0;
    const factory: McpClientFactory = async () => {
      factoryCalls++;
      return fake;
    };
    let reauthFired = false;
    const session = new McpClientSession(
      "c",
      fake,
      oauthConnector,
      constToken,
      {
        onReauthNeeded: () => {
          reauthFired = true;
        },
      },
      factory,
    );
    const result = await session.callTool(sampleCall);
    expect(result.isError).toBe(true);
    expect(callsMade).toBe(1);
    expect(factoryCalls).toBe(0);
    expect(reauthFired).toBe(false);
  });

  test("falls through to reauth notification when reconnect itself fails", async () => {
    const first = makeFakeClient([401]);
    const factory: McpClientFactory = async () => {
      throw new Error("network down");
    };
    const reauths: string[] = [];
    const session = new McpClientSession(
      "c",
      first.client,
      oauthConnector,
      constToken,
      {
        onReauthNeeded: (id) => {
          reauths.push(id);
        },
      },
      factory,
    );
    const result = await session.callTool(sampleCall);
    expect(result.isError).toBe(true);
    expect(reauths).toEqual(["c"]);
  });
});
