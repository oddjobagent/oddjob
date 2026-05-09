import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { QueueSqliteProvider } from "./provider.ts";

let dir: string;
let q: QueueSqliteProvider;
const W1 = "worker-1";
const W2 = "worker-2";

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
    expect(id).toMatch(/^run_[0-9a-hjkmnp-tv-z]{14}$/);

    const claimed = await q.dequeue(W1, 5000);
    expect(claimed?.runId).toBe(id);
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.config.deploymentId).toBe("d1");

    let depth = await q.depth();
    expect(depth.running).toBe(1);

    expect(await q.ack(id, W1)).toBe("ok");
    depth = await q.depth();
    expect(depth.running).toBe(0);
  });

  test("ack from wrong worker returns lease_lost", async () => {
    const id = await q.enqueue({
      deploymentId: "d1",
      blueprintId: "demo/echo",
      triggeredBy: "manual",
    });
    await q.dequeue(W1, 5000);
    expect(await q.ack(id, W2)).toBe("lease_lost");
    expect(await q.ack(id, W1)).toBe("ok");
  });

  test("nack moves to failed; wrong worker is no-op", async () => {
    const id = await q.enqueue({
      deploymentId: "d1",
      blueprintId: "demo/echo",
      triggeredBy: "manual",
    });
    await q.dequeue(W1, 5000);
    expect(await q.nack(id, W2, "wrong worker")).toBe("lease_lost");
    expect(await q.nack(id, W1, "real fail")).toBe("ok");
    const depth = await q.depth();
    expect(depth.failed).toBeGreaterThanOrEqual(1);
  });

  test("two workers cannot claim same run", async () => {
    const id = await q.enqueue({
      deploymentId: "d1",
      blueprintId: "demo/echo",
      triggeredBy: "manual",
    });
    const a = await q.dequeue(W1, 5000);
    const b = await q.dequeue(W2, 5000);
    expect(a?.runId).toBe(id);
    expect(b?.runId).not.toBe(id);
    await q.ack(id, W1);
    if (b) await q.ack(b.runId, W2);
  });

  test("requeue with delay defers re-pickup until availableAt elapses", async () => {
    const id = await q.enqueue({
      deploymentId: "d1",
      blueprintId: "demo/echo",
      triggeredBy: "manual",
    });
    await q.dequeue(W1, 5000);
    expect(await q.requeue(id, W1, 200)).toBe("ok");
    // Immediately after requeue: should NOT be claimable.
    const tooEarly = await q.dequeue(W2, 5000);
    expect(tooEarly?.runId).not.toBe(id);
    if (tooEarly) await q.ack(tooEarly.runId, W2);
    // Wait past the backoff and confirm it's claimable.
    await new Promise((r) => setTimeout(r, 250));
    const claimed = await q.dequeue(W2, 5000);
    expect(claimed?.runId).toBe(id);
    expect(claimed?.attempts).toBe(2);
    if (claimed) await q.ack(claimed.runId, W2);
  });

  test("requeue from wrong worker returns lease_lost", async () => {
    const id = await q.enqueue({
      deploymentId: "d1",
      blueprintId: "demo/echo",
      triggeredBy: "manual",
    });
    await q.dequeue(W1, 5000);
    expect(await q.requeue(id, W2, 100)).toBe("lease_lost");
    await q.ack(id, W1);
  });

  test("reclaimStale recovers expired leases", async () => {
    const id = await q.enqueue({
      deploymentId: "d1",
      blueprintId: "demo/echo",
      triggeredBy: "manual",
    });
    await q.dequeue(W1, -1000);
    const reclaimed = await q.reclaimStale();
    expect(reclaimed).toBeGreaterThanOrEqual(1);
    const claimed = await q.dequeue(W2, 5000);
    expect(claimed?.runId).toBe(id);
    if (claimed) await q.ack(claimed.runId, W2);
  });
});
