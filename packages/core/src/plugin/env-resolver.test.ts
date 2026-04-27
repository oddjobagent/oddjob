import { describe, expect, test } from "bun:test";

import { definePlugin } from "../../../sdk/src/index.ts";
import type { Environment, EnvironmentConfig } from "../types/environment.ts";
import {
  EnvironmentNotFoundError,
  EnvironmentServiceNotRegisteredError,
  NoEnvironmentResolvedError,
  mergeConfigs,
  resolveEnvironment,
} from "./env-resolver.ts";
import { PluginRegistry } from "./registry.ts";

const fakeSession = {
  sessionWorkdir: "/tmp",
  exec: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 0, truncated: false }),
  writeFile: async () => undefined,
  readFile: async () => "",
  kill: async () => undefined,
};

const fakeProvider = {
  name: "fake",
  connect: async () => undefined,
  disconnect: async () => undefined,
  healthy: async () => true,
  spawn: async () => fakeSession,
};

const noopCaps = {
  snapshot: false,
  fork: false,
  pauseResume: false,
  exposePort: false,
  egressAllowlist: false,
  packageManagers: [] as const,
};

function buildRegistryWith(serviceIds: string[]): PluginRegistry {
  const reg = new PluginRegistry();
  for (const id of serviceIds) {
    reg.register(
      definePlugin({ slug: `plugin-${id}`, version: "0.0.1" }, (b) =>
        b.environment({
          id,
          displayName: id,
          trustTier: "trusted",
          capabilities: noopCaps,
          available: async () => ({ ok: true }),
          create: () => fakeProvider,
        }),
      ),
      "bundled",
    );
  }
  return reg;
}

function envRecord(id: string, partial: Partial<EnvironmentConfig> = {}): Environment {
  const config: EnvironmentConfig = {
    type: "local",
    provider: { service: "process" },
    ...partial,
  };
  return { id, config, createdAt: 0, updatedAt: 0 };
}

describe("resolveEnvironment cascade", () => {
  test("path 1: deployment inline only — anonymous environment", async () => {
    const reg = buildRegistryWith(["seatbelt"]);
    const r = await resolveEnvironment({
      deployment: {
        environmentInline: {
          type: "local",
          provider: { service: "seatbelt" },
        },
      },
      getEnvironment: async () => null,
      registry: reg,
    });
    expect(r.source).toBe("inline");
    expect(r.config.provider?.service).toBe("seatbelt");
    expect(r.envRecord).toBeUndefined();
  });

  test("path 2: deployment references stored env, no override", async () => {
    const reg = buildRegistryWith(["docker"]);
    const stored = envRecord("data", { type: "cloud", provider: { service: "docker" } });
    const r = await resolveEnvironment({
      deployment: { environmentId: "data" },
      getEnvironment: async (id) => (id === "data" ? stored : null),
      registry: reg,
    });
    expect(r.source).toBe("deployment-ref");
    expect(r.config.type).toBe("cloud");
    expect(r.config.provider?.service).toBe("docker");
    expect(r.envRecord?.id).toBe("data");
  });

  test("path 2: deployment references env + inline override merges", async () => {
    const reg = buildRegistryWith(["docker"]);
    const stored = envRecord("data", {
      type: "cloud",
      provider: { service: "docker" },
      networking: { type: "limited", allowedHosts: ["openrouter.ai"] },
      image: "old-image",
    });
    const r = await resolveEnvironment({
      deployment: {
        environmentId: "data",
        environmentInline: {
          image: "new-image",
          networking: { type: "limited", allowedHosts: ["api.github.com"] },
        },
      },
      getEnvironment: async (id) => (id === "data" ? stored : null),
      registry: reg,
    });
    expect(r.source).toBe("deployment-ref");
    expect(r.config.image).toBe("new-image");
    const net = r.config.networking;
    expect(net?.type).toBe("limited");
    if (net?.type === "limited") {
      expect(net.allowedHosts.toSorted()).toEqual(["api.github.com", "openrouter.ai"]);
    }
  });

  test("path 3: engine default environment", async () => {
    const reg = buildRegistryWith(["seatbelt"]);
    const stored = envRecord("eng-default", { provider: { service: "seatbelt" } });
    const r = await resolveEnvironment({
      deployment: {},
      getEnvironment: async (id) => (id === "eng-default" ? stored : null),
      engineDefaultId: "eng-default",
      registry: reg,
    });
    expect(r.source).toBe("engine-default");
    expect(r.envRecord?.id).toBe("eng-default");
  });

  test("path 4: hard default environment", async () => {
    const reg = buildRegistryWith(["seatbelt"]);
    const stored = envRecord("default", { provider: { service: "seatbelt" } });
    const r = await resolveEnvironment({
      deployment: {},
      getEnvironment: async (id) => (id === "default" ? stored : null),
      hardDefaultId: "default",
      registry: reg,
    });
    expect(r.source).toBe("hard-default");
  });

  test("missing environment id throws EnvironmentNotFoundError", async () => {
    const reg = buildRegistryWith(["seatbelt"]);
    await expect(
      resolveEnvironment({
        deployment: { environmentId: "missing" },
        getEnvironment: async () => null,
        registry: reg,
      }),
    ).rejects.toBeInstanceOf(EnvironmentNotFoundError);
  });

  test("missing service plugin throws EnvironmentServiceNotRegisteredError", async () => {
    const reg = buildRegistryWith(["seatbelt"]);
    const stored = envRecord("env", { provider: { service: "daytona" } });
    await expect(
      resolveEnvironment({
        deployment: { environmentId: "env" },
        getEnvironment: async () => stored,
        registry: reg,
      }),
    ).rejects.toBeInstanceOf(EnvironmentServiceNotRegisteredError);
  });

  test("nothing supplied throws NoEnvironmentResolvedError", async () => {
    const reg = buildRegistryWith(["seatbelt"]);
    await expect(
      resolveEnvironment({
        deployment: {},
        getEnvironment: async () => null,
        registry: reg,
      }),
    ).rejects.toBeInstanceOf(NoEnvironmentResolvedError);
  });

  test("fallbackServiceId fills in when env has no provider.service", async () => {
    const reg = buildRegistryWith(["process"]);
    const stored: Environment = {
      id: "loose",
      config: { type: "local" },
      createdAt: 0,
      updatedAt: 0,
    };
    const r = await resolveEnvironment({
      deployment: { environmentId: "loose" },
      getEnvironment: async () => stored,
      registry: reg,
      fallbackServiceId: "process",
    });
    expect(r.service.id).toBe("process");
  });
});

describe("mergeConfigs", () => {
  test("inline replaces base key-by-key", () => {
    const merged = mergeConfigs(
      { type: "cloud", image: "old", workingDir: "/old" },
      { image: "new" },
    );
    expect(merged.type).toBe("cloud");
    expect(merged.image).toBe("new");
    expect(merged.workingDir).toBe("/old");
  });

  test("networking allowedHosts concat-deduped when both limited", () => {
    const merged = mergeConfigs(
      { networking: { type: "limited", allowedHosts: ["a.com", "b.com"] } },
      { networking: { type: "limited", allowedHosts: ["b.com", "c.com"] } },
    );
    const net = merged.networking;
    expect(net?.type).toBe("limited");
    if (net?.type === "limited") {
      expect(net.allowedHosts.toSorted()).toEqual(["a.com", "b.com", "c.com"]);
    }
  });

  test("networking type change wins (limited then unrestricted)", () => {
    const merged = mergeConfigs(
      { networking: { type: "limited", allowedHosts: ["a.com"] } },
      { networking: { type: "unrestricted" } },
    );
    expect(merged.networking?.type).toBe("unrestricted");
  });

  test("provider credential falls back to base when inline omits it", () => {
    const merged = mergeConfigs(
      { provider: { service: "docker", credential: "default" } },
      { provider: { service: "docker" } },
    );
    expect(merged.provider?.credential).toBe("default");
  });

  test("inline can override credential alone (service inherited from base)", () => {
    const merged = mergeConfigs(
      { provider: { service: "daytona", credential: "default" } },
      { provider: { credential: "tenant-A" } },
    );
    expect(merged.provider?.service).toBe("daytona");
    expect(merged.provider?.credential).toBe("tenant-A");
  });

  test("inline provider with neither service nor credential is dropped (no base)", () => {
    const merged = mergeConfigs(undefined, { provider: {} });
    expect(merged.provider).toBeUndefined();
  });

  test("packages merge per-package-manager (apt + pip survives an npm-only override)", () => {
    const merged = mergeConfigs(
      { packages: { apt: ["ffmpeg"], pip: ["pandas"] } },
      { packages: { npm: ["puppeteer"] } },
    );
    expect(merged.packages?.apt).toEqual(["ffmpeg"]);
    expect(merged.packages?.pip).toEqual(["pandas"]);
    expect(merged.packages?.npm).toEqual(["puppeteer"]);
  });

  test("resources merge per-key (cpu override keeps base memMb/diskMb)", () => {
    const merged = mergeConfigs(
      { resources: { cpu: 1, memMb: 512, diskMb: 1024 } },
      { resources: { cpu: 4 } },
    );
    expect(merged.resources?.cpu).toBe(4);
    expect(merged.resources?.memMb).toBe(512);
    expect(merged.resources?.diskMb).toBe(1024);
  });
});
