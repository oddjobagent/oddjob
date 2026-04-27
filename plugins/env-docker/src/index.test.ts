import { describe, expect, test } from "bun:test";

import plugin from "./index.ts";

describe("env-docker plugin (unit)", () => {
  test("manifest slug + service shape", () => {
    expect(plugin.manifest.slug).toBe("env-docker");
    expect(plugin.services).toHaveLength(1);
    const svc = plugin.services[0]!;
    expect(svc.kind).toBe("environment");
    if (svc.kind !== "environment") throw new Error("unreachable");
    expect(svc.id).toBe("docker");
    expect(svc.trustTier).toBe("container");
    expect(svc.capabilities.pauseResume).toBe(true);
    expect(svc.capabilities.snapshot).toBe(false);
    expect(svc.capabilities.fork).toBe(false);
    expect(svc.capabilities.packageManagers).toEqual(["apt", "pip", "npm"]);
  });

  test("create() returns a provider", () => {
    const svc = plugin.services[0]!;
    if (svc.kind !== "environment") throw new Error("unreachable");
    const provider = svc.create();
    expect(provider.name).toBe("env-docker");
  });
});
