import { describe, expect, test } from "bun:test";

import { StorageLocalProvider } from "./provider.ts";

describe("@oddjob/storage-local canary", () => {
  test("provider class instantiates", () => {
    const p = new StorageLocalProvider();
    expect(p.name).toBe("storage-local");
  });
});
