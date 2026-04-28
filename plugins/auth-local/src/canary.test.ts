import { describe, expect, test } from "bun:test";

import { AuthLocalProvider } from "./provider.ts";

describe("@oddjob/auth-local canary", () => {
  test("provider class instantiates", () => {
    const p = new AuthLocalProvider({
      state: {} as never,
      secrets: {} as never,
      masterKey: Buffer.alloc(32),
    });
    expect(p.name).toBe("auth-local");
  });
});
