import { describe, expect, test } from "bun:test";

import { QueueSqliteProvider } from "./provider.ts";

describe("@oddjob/queue-sqlite canary", () => {
  test("provider class instantiates", () => {
    const p = new QueueSqliteProvider();
    expect(p.name).toBe("queue-sqlite");
  });
});
