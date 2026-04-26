import { describe, expect, test } from "bun:test";

import { DEFAULT_LIMITS } from "./types/limits.ts";

describe("@oddjob/core canary", () => {
  test("exports DEFAULT_LIMITS with sensible defaults", () => {
    expect(DEFAULT_LIMITS.warnThresholdPct).toBeGreaterThan(0);
    expect(DEFAULT_LIMITS.warnThresholdPct).toBeLessThanOrEqual(100);
  });
});
