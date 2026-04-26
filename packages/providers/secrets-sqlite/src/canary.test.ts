import { describe, expect, test } from "bun:test";

import { SecretsSqliteProvider } from "./provider.ts";

describe("@oddjob/secrets-sqlite canary", () => {
  test("provider class instantiates", () => {
    const p = new SecretsSqliteProvider();
    expect(p.name).toBe("secrets-sqlite");
  });
});
