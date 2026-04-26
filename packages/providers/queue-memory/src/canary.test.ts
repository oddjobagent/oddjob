import { describe, expect, test } from "bun:test";

import { QueueMemoryProvider } from "./provider.ts";

describe("@oddjob/queue-memory canary", () => {
  test("provider class instantiates", () => {
    const p = new QueueMemoryProvider();
    expect(p.name).toBe("queue-memory");
  });
});
