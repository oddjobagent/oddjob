import { describe, expect, test } from "bun:test";

import { SandboxProcessProvider } from "./provider.ts";

describe("@oddjob/sandbox-process canary", () => {
  test("provider class instantiates", () => {
    const p = new SandboxProcessProvider();
    expect(p.name).toBe("sandbox-process");
  });
});
