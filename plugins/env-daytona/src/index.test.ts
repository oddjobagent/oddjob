import { describe, expect, test } from "bun:test";

import Ajv from "ajv";

import type { LogEntry } from "@oddjob/core";

import plugin from "./index.ts";
import { DaytonaEnvironmentProvider } from "./provider.ts";

describe("env-daytona plugin (unit)", () => {
  test("manifest slug + service shape", () => {
    expect(plugin.manifest.slug).toBe("env-daytona");
    expect(plugin.services).toHaveLength(1);
    const svc = plugin.services[0]!;
    expect(svc.kind).toBe("environment");
    if (svc.kind !== "environment") throw new Error("unreachable");
    expect(svc.id).toBe("daytona");
    expect(svc.trustTier).toBe("remote-vm");
    expect(svc.capabilities.snapshot).toBe(true);
    expect(svc.capabilities.fork).toBe(true);
    expect(svc.capabilities.pauseResume).toBe(true);
    expect(svc.capabilities.exposePort).toBe(true);
    expect(svc.capabilities.egressAllowlist).toBe(false);
    expect(svc.capabilities.packageManagers).toEqual(["apt", "pip", "npm"]);
  });

  test("available() refuses without credential", async () => {
    const svc = plugin.services[0]!;
    if (svc.kind !== "environment") throw new Error("unreachable");
    const r = await svc.available();
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("no DAYTONA_API_KEY");
  });

  test("create() refuses without apiKey", () => {
    const svc = plugin.services[0]!;
    if (svc.kind !== "environment") throw new Error("unreachable");
    expect(() => svc.create()).toThrow(/no API key/);
    expect(() => svc.create({})).toThrow(/no API key/);
  });

  test("authSchema validates apiKey shape", () => {
    const svc = plugin.services[0]!;
    if (svc.kind !== "environment") throw new Error("unreachable");
    // typebox JSON Schema; validate via Ajv at runtime.
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(svc.authSchema as object);
    expect(validate({ apiKey: "dtn_" + "x".repeat(60) })).toBe(true);
    expect(validate({ apiKey: "short" })).toBe(false);
    expect(validate({})).toBe(false);
  });
});

describe("DaytonaEnvironmentProvider egress proxy honest doc (15i-2)", () => {
  test("spawn drops proxy env vars and emits warn log when egressProxy is set", async () => {
    // We can't actually spin up a Daytona sandbox in unit tests; instead we
    // assert the proxy-injection branch by stubbing the SDK's `client.create`
    // and inspecting the envVars argument plus the warn log.
    type CreateArgs = { envVars: Record<string, string> };
    const captured: CreateArgs[] = [];
    const fakeSandbox = {
      process: {
        executeCommand: async () => ({ exitCode: 0, result: "", artifacts: undefined }),
      },
      fs: { uploadFile: async () => undefined, downloadFile: async () => Buffer.from("") },
    };
    const provider = new DaytonaEnvironmentProvider({ apiKey: "dtn_" + "x".repeat(60) });
    // Hot-swap the private client with a stub. This is an internal test
    // contract: the constructor reads `opts.apiKey` to build a Daytona client,
    // and we replace that client wholesale here.
    (provider as unknown as { client: { create: (args: CreateArgs) => Promise<unknown> } }).client =
      {
        create: async (args: CreateArgs) => {
          captured.push(args);
          return fakeSandbox;
        },
      };

    const logs: LogEntry[] = [];
    await provider.spawn({
      egressProxy: { url: "http://oddjob:t0k@127.0.0.1:8888", caPem: "" },
      onLog: (entry) => logs.push(entry),
    });

    const envVars = captured[0]?.envVars ?? {};
    // No proxy env vars should be set — remote-vm tier cannot reach the
    // operator loopback so we explicitly skip injection rather than wire a
    // dead URL.
    expect(envVars.HTTPS_PROXY).toBeUndefined();
    expect(envVars.HTTP_PROXY).toBeUndefined();
    expect(envVars.https_proxy).toBeUndefined();
    expect(envVars.http_proxy).toBeUndefined();
    // No 127.0.0.1 leak in any env var.
    for (const [, v] of Object.entries(envVars)) {
      expect(v).not.toContain("127.0.0.1");
    }
    // A warn log must surface so operators know egress falls through to
    // Daytona's own network policy.
    const warn = logs.find((l) => l.level === "warn");
    expect(warn).toBeDefined();
    expect(warn?.message).toContain("egress proxy not applied");
    expect(warn?.message).toMatch(/daytona|remote-vm/i);
    // 15i-2 codex MED 1: warn meta must NOT leak the per-Run proxy auth
    // token. Only host + port are surfaced.
    const metaJson = JSON.stringify(warn?.meta ?? {});
    expect(metaJson).not.toContain("t0k");
    expect(metaJson).not.toContain("oddjob:");
    expect(warn?.meta?.proxyHost).toBe("127.0.0.1");
    expect(warn?.meta?.proxyPort).toBe("8888");
  });

  test("spawn without egressProxy emits no warn log", async () => {
    const provider = new DaytonaEnvironmentProvider({ apiKey: "dtn_" + "x".repeat(60) });
    (provider as unknown as { client: { create: () => Promise<unknown> } }).client = {
      create: async () => ({
        process: { executeCommand: async () => ({ exitCode: 0, result: "" }) },
        fs: { uploadFile: async () => undefined, downloadFile: async () => Buffer.from("") },
      }),
    };
    const logs: LogEntry[] = [];
    await provider.spawn({ onLog: (entry) => logs.push(entry) });
    expect(logs.find((l) => l.level === "warn" && /egress/.test(l.message))).toBeUndefined();
  });
});
