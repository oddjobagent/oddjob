import { describe, expect, test } from "bun:test";

import plugin from "./index.ts";

describe("env-local-strict plugin", () => {
  test("registers seatbelt + bwrap + appcontainer services", () => {
    expect(plugin.manifest.slug).toBe("env-local-strict");
    const ids = plugin.services
      .filter((s) => s.kind === "environment")
      .map((s) => (s.kind === "environment" ? s.id : ""))
      .toSorted();
    expect(ids).toEqual(["appcontainer", "bwrap", "seatbelt"]);
  });

  test("each service declares trustTier=local-strict", () => {
    for (const svc of plugin.services) {
      if (svc.kind !== "environment") continue;
      expect(svc.trustTier).toBe("local-strict");
    }
  });

  test("available() reflects host platform", async () => {
    const seatbelt = plugin.services.find((s) => s.kind === "environment" && s.id === "seatbelt");
    if (!seatbelt || seatbelt.kind !== "environment") throw new Error("seatbelt missing");
    const result = await seatbelt.available();
    if (process.platform === "darwin") {
      expect(result.ok).toBe(true);
    } else {
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("macOS");
    }
  });

  test("appcontainer always returns not-implemented on Win, OS-mismatch elsewhere", async () => {
    const ac = plugin.services.find((s) => s.kind === "environment" && s.id === "appcontainer");
    if (!ac || ac.kind !== "environment") throw new Error("appcontainer missing");
    const r = await ac.available();
    expect(r.ok).toBe(false);
  });

  test("appcontainer.spawn() throws (must not silently run unwrapped)", async () => {
    const ac = plugin.services.find((s) => s.kind === "environment" && s.id === "appcontainer");
    if (!ac || ac.kind !== "environment") throw new Error("appcontainer missing");
    const provider = ac.create();
    await expect(provider.spawn({})).rejects.toThrow(/not yet implemented/);
  });
});
