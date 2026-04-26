import { describe, expect, test } from "bun:test";

import { SchedulerCronerProvider } from "./provider.ts";

describe("@oddjob/scheduler-croner canary", () => {
  test("provider class instantiates", () => {
    const p = new SchedulerCronerProvider();
    expect(p.name).toBe("scheduler-croner");
  });
});
