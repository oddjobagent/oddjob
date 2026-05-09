import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MessageRecord } from "@oddjob/core";

import { RunMessageSqliteProvider } from "./run-message-provider.ts";

describe("RunMessageSqliteProvider", () => {
  let dir: string;
  let provider: RunMessageSqliteProvider;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "oddjob-runmsg-"));
    provider = new RunMessageSqliteProvider({ path: join(dir, "state.db") });
    await provider.connect();
  });

  afterEach(async () => {
    await provider.disconnect();
    await rm(dir, { recursive: true, force: true });
  });

  it("records and retrieves messages in seq order", async () => {
    const records: MessageRecord[] = [
      { runId: "r1", seq: 0, role: "user", content: { text: "hello" }, recordedAt: 100 },
      {
        runId: "r1",
        seq: 1,
        role: "assistant",
        content: [{ type: "text", text: "hi back" }],
        recordedAt: 110,
      },
      { runId: "r1", seq: 2, role: "user", content: { text: "again" }, recordedAt: 120 },
    ];
    for (const r of records) await provider.recordMessage(r);
    const out = await provider.getMessages("r1");
    expect(out).toHaveLength(3);
    expect(out.map((m) => m.seq)).toEqual([0, 1, 2]);
    expect(out[0]?.content).toEqual({ text: "hello" });
    expect(out[1]?.role).toBe("assistant");
  });

  it("scopes by runId", async () => {
    await provider.recordMessage({
      runId: "r1",
      seq: 0,
      role: "user",
      content: "a",
      recordedAt: 100,
    });
    await provider.recordMessage({
      runId: "r2",
      seq: 0,
      role: "user",
      content: "b",
      recordedAt: 100,
    });
    expect((await provider.getMessages("r1"))).toHaveLength(1);
    expect((await provider.getMessages("r2"))).toHaveLength(1);
  });

  it("filters by role + sinceSeq", async () => {
    for (let i = 0; i < 5; i++) {
      await provider.recordMessage({
        runId: "r1",
        seq: i,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `msg ${i}`,
        recordedAt: 100 + i,
      });
    }
    const usersFromSeq2 = await provider.getMessages("r1", { role: "user", sinceSeq: 2 });
    expect(usersFromSeq2.map((m) => m.seq)).toEqual([2, 4]);
  });

  it("nextSeq returns 0 for empty run, then increments", async () => {
    expect(await provider.nextSeq("r-empty")).toBe(0);
    await provider.recordMessage({
      runId: "r1",
      seq: 0,
      role: "user",
      content: "a",
      recordedAt: 100,
    });
    expect(await provider.nextSeq("r1")).toBe(1);
    await provider.recordMessage({
      runId: "r1",
      seq: 1,
      role: "user",
      content: "b",
      recordedAt: 101,
    });
    expect(await provider.nextSeq("r1")).toBe(2);
  });

  it("rejects duplicate (run_id, seq)", async () => {
    await provider.recordMessage({
      runId: "r1",
      seq: 0,
      role: "user",
      content: "a",
      recordedAt: 100,
    });
    await expect(() =>
      provider.recordMessage({
        runId: "r1",
        seq: 0,
        role: "user",
        content: "different",
        recordedAt: 200,
      }),
    ).toThrow();
  });
});
