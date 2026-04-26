import { describe, expect, test } from "bun:test";

import { LoggingSqliteProvider } from "./provider.ts";

describe("@oddjob/logging-sqlite canary", () => {
  test("provider class instantiates", () => {
    const p = new LoggingSqliteProvider();
    expect(p.name).toBe("logging-sqlite");
  });
});
