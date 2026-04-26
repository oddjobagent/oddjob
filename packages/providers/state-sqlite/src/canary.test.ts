import { describe, expect, test } from "bun:test";

import { StateSqliteProvider } from "./provider.ts";

describe("@oddjob/state-sqlite canary", () => {
  test("provider class instantiates", () => {
    const p = new StateSqliteProvider();
    expect(p.name).toBe("state-sqlite");
  });
});
