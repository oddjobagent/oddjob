import { describe, expect, test } from "bun:test";

import { definePlugin } from "../../../sdk/src/index.ts";
import { PluginRegistry } from "./registry.ts";

const fakeSession = {
  async exec() {
    return { exitCode: 0, stdout: "", stderr: "", durationMs: 0, truncated: false };
  },
  async writeFile() {},
  async readFile() {
    return "";
  },
  async kill() {},
};

const fakeEnvProvider = {
  name: "fake-env",
  async connect() {},
  async disconnect() {},
  async healthy() {
    return true;
  },
  async spawn() {
    return fakeSession;
  },
};

const fakeCapabilities = {
  snapshot: false,
  fork: false,
  pauseResume: false,
  exposePort: false,
  egressAllowlist: false,
  packageManagers: [] as const,
};

describe("PluginRegistry environment services", () => {
  test("register + environmentFor + listEnvironments round trip", () => {
    const reg = new PluginRegistry();
    const plugin = definePlugin({ slug: "fake-env", version: "0.0.1" }, (b) =>
      b.environment({
        id: "fake",
        displayName: "Fake env",
        trustTier: "trusted",
        capabilities: fakeCapabilities,
        async available() {
          return { ok: true };
        },
        create: () => fakeEnvProvider,
      }),
    );

    reg.register(plugin, "bundled");

    const found = reg.environmentFor("fake");
    expect(found).toBeDefined();
    expect(found?.id).toBe("fake");
    expect(found?.trustTier).toBe("trusted");
    expect(reg.listEnvironments()).toHaveLength(1);
  });

  test("duplicate id throws", () => {
    const reg = new PluginRegistry();
    const make = (slug: string) =>
      definePlugin({ slug, version: "0.0.1" }, (b) =>
        b.environment({
          id: "dup",
          displayName: "X",
          trustTier: "trusted",
          capabilities: fakeCapabilities,
          async available() {
            return { ok: true };
          },
          create: () => fakeEnvProvider,
        }),
      );
    reg.register(make("p1"), "bundled");
    expect(() => reg.register(make("p2"), "bundled")).toThrow(/already registered/);
  });

  test("intra-plugin duplicate environment id throws + leaves registry untouched", () => {
    const reg = new PluginRegistry();
    const plugin = definePlugin({ slug: "dup-self", version: "0.0.1" }, (b) => {
      b.environment({
        id: "twin",
        displayName: "First",
        trustTier: "trusted",
        capabilities: fakeCapabilities,
        async available() {
          return { ok: true };
        },
        create: () => fakeEnvProvider,
      });
      b.environment({
        id: "twin",
        displayName: "Second",
        trustTier: "trusted",
        capabilities: fakeCapabilities,
        async available() {
          return { ok: true };
        },
        create: () => fakeEnvProvider,
      });
    });
    expect(() => reg.register(plugin, "bundled")).toThrow(/declared twice/);
    expect(reg.environmentFor("twin")).toBeUndefined();
    expect(reg.list()).toHaveLength(0);
  });

  test("unregister removes the environment service", () => {
    const reg = new PluginRegistry();
    const plugin = definePlugin({ slug: "fake-env", version: "0.0.1" }, (b) =>
      b.environment({
        id: "fake",
        displayName: "Fake env",
        trustTier: "container",
        capabilities: {
          snapshot: true,
          fork: false,
          pauseResume: false,
          exposePort: false,
          egressAllowlist: true,
          packageManagers: ["apt", "pip"],
        },
        async available() {
          return { ok: true };
        },
        create: () => fakeEnvProvider,
      }),
    );
    reg.register(plugin, "bundled");
    expect(reg.environmentFor("fake")).toBeDefined();
    reg.unregister("fake-env");
    expect(reg.environmentFor("fake")).toBeUndefined();
    expect(reg.listEnvironments()).toHaveLength(0);
  });
});
