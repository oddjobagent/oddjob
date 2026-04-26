import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { LoggingSqliteProvider } from "./provider.ts";

let dir: string;
let p: LoggingSqliteProvider;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-logs-"));
  p = new LoggingSqliteProvider({ path: join(dir, "logs.db") });
  await p.connect();
});

afterAll(async () => {
  await p.disconnect();
  await rm(dir, { recursive: true, force: true });
});

describe("LoggingSqliteProvider", () => {
  test("log + getLogs ordering", async () => {
    await p.log("r1", { timestamp: 100, level: "info", message: "first" });
    await p.log("r1", { timestamp: 200, level: "warn", message: "second", meta: { tool: "x" } });
    const all = await p.getLogs("r1");
    expect(all.length).toBe(2);
    expect(all[0]?.message).toBe("first");
    expect(all[1]?.meta?.tool).toBe("x");
  });

  test("filter by level", async () => {
    const warns = await p.getLogs("r1", { level: "warn" });
    expect(warns.length).toBe(1);
  });

  test("since filter", async () => {
    const recent = await p.getLogs("r1", { since: 150 });
    expect(recent.length).toBe(1);
    expect(recent[0]?.message).toBe("second");
  });
});
