import { describe, expect, test } from "bun:test";

import { DEFAULT_LIMITS } from "@oddjob/core";

describe("@oddjob/sdk canary", () => {
  test("re-exports core", () => {
    expect(DEFAULT_LIMITS).toBeDefined();
  });
});
