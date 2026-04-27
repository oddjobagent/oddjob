import { describe, expect, test } from "bun:test";

import plugin from "./index.ts";

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
    const schema = svc.authSchema as { safeParse: (v: unknown) => { success: boolean } };
    expect(schema.safeParse({ apiKey: "dtn_" + "x".repeat(60) }).success).toBe(true);
    expect(schema.safeParse({ apiKey: "short" }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });
});
