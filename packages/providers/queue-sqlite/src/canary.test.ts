import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { QueueSqliteProvider } from "./provider.ts";

let dir: string;
let q: QueueSqliteProvider;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-queue-"));
  q = new QueueSqliteProvider({ path: join(dir, "queue.db") });
  await q.connect();
});

afterAll(async () => {
  await q.disconnect();
  await rm(dir, { recursive: true, force: true });
});

describe("QueueSqliteProvider", () => {
  test("enqueue + dequeue + ack", async () => {
    const id = await q.enqueue({
      deploymentId: "d1",
      blueprintId: "demo/echo",
      triggeredBy: "manual",
    });
    expect(id).toMatch(/^[0-9a-f-]+$/);

    const claimed = await q.dequeue("worker-1", 5000);
    expect(claimed?.runId).toBe(id);
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.config.deploymentId).toBe("d1");

    let depth = await q.depth();
    expect(depth.running).toBe(1);

    await q.ack(id);
    depth = await q.depth();
    expect(depth.running).toBe(0);
  });

  test("nack moves to failed", async () => {
    const id = await q.enqueue({
      deploymentId: "d1",
      blueprintId: "demo/echo",
      triggeredBy: "manual",
    });
    await q.dequeue("worker-1", 5000);
    await q.nack(id, "boom");
    const depth = await q.depth();
    expect(depth.failed).toBeGreaterThanOrEqual(1);
  });

  test("two workers cannot claim same run", async () => {
    const id = await q.enqueue({
      deploymentId: "d1",
      blueprintId: "demo/echo",
      triggeredBy: "manual",
    });
    const a = await q.dequeue("worker-A", 5000);
    const b = await q.dequeue("worker-A", 5000);
    expect(a?.runId).toBe(id);
    expect(b?.runId).not.toBe(id);
    await q.ack(id);
    if (b) await q.ack(b.runId);
  });

  test("reclaimStale recovers expired leases", async () => {
    const id = await q.enqueue({
      deploymentId: "d1",
      blueprintId: "demo/echo",
      triggeredBy: "manual",
    });
    await q.dequeue("worker-X", -1000);
    const reclaimed = await q.reclaimStale();
    expect(reclaimed).toBeGreaterThanOrEqual(1);
    const claimed = await q.dequeue("worker-Y", 5000);
    expect(claimed?.runId).toBe(id);
    if (claimed) await q.ack(claimed.runId);
  });
});
