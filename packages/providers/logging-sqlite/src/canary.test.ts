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

  test("redacts token-shape strings inside meta_json", async () => {
    await p.log("r-redact", {
      timestamp: 300,
      level: "info",
      message: "tool call web_fetch",
      meta: {
        args: {
          token: "ghp_aaaaaaaaaaaaaaaaaaaa",
          nested: { auth: "Bearer sk-ant-1234567890abcdefghij" },
          list: ["xoxb-1111111111-2222222222-abcdefghijklmnop"],
        },
      },
    });
    const rows = await p.getLogs("r-redact");
    expect(rows.length).toBe(1);
    const meta = rows[0]?.meta as { args: Record<string, unknown> } | undefined;
    expect(JSON.stringify(meta)).not.toContain("ghp_aaaaaaaaaaaaaaaaaaaa");
    expect(JSON.stringify(meta)).not.toContain("sk-ant-");
    expect(JSON.stringify(meta)).not.toContain("xoxb-");
    expect(JSON.stringify(meta)).toContain("[REDACTED]");
    const args = meta?.args as { token: string } | undefined;
    expect(args?.token).toBe("[REDACTED]");
  });

  test("redacts token-shape strings in message column", async () => {
    await p.log("r-redact-msg", {
      timestamp: 400,
      level: "info",
      message: "fetched url with leak ghp_bbbbbbbbbbbbbbbbbbbb embedded",
    });
    const rows = await p.getLogs("r-redact-msg");
    expect(rows[0]?.message).toContain("[REDACTED]");
    expect(rows[0]?.message).not.toContain("ghp_bbbbb");
  });

  test("redacts tokens that surface only via toJSON (storage-layer canonical scrub)", async () => {
    // The agent-side `deepRedact` strips function values, but a meta object
    // routed through any other path (e.g. tool dispatchers logging directly)
    // could carry a custom toJSON. The storage layer must still scrub.
    const sneaky = {
      name: "safe",
      toJSON: () => ({ leak: "ghp_ccccccccccccccccccccc" }),
    };
    await p.log("r-toJSON", {
      timestamp: 500,
      level: "info",
      message: "tool call",
      meta: { args: sneaky },
    });
    const rows = await p.getLogs("r-toJSON");
    expect(rows.length).toBe(1);
    const stored = JSON.stringify(rows[0]?.meta);
    expect(stored).not.toContain("ghp_ccccccc");
    expect(stored).toContain("[REDACTED]");
  });

  test("persists meta containing a BigInt without throwing (deepRedact fallback)", async () => {
    // Without BigInt handling, JSON.stringify({n: 1n}) throws and
    // LoggingSqliteProvider.log() rejects, dropping the entire log line.
    await p.log("r-bigint", {
      timestamp: 600,
      level: "info",
      message: "tool call with bigint count",
      meta: { args: { count: 9_999_999_999_999_999n, name: "ok" } },
    });
    const rows = await p.getLogs("r-bigint");
    expect(rows.length).toBe(1);
    const stored = JSON.stringify(rows[0]?.meta);
    expect(stored).toContain('"count":"9999999999999999n"');
    expect(stored).toContain('"name":"ok"');
  });
});
