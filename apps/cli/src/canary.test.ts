import { describe, expect, test } from "bun:test";

describe("@oddjob/cli canary", () => {
  test("entry module loads without throwing", async () => {
    const setup = await import("./commands/setup.ts");
    expect(setup.default).toBeDefined();
  });
});
