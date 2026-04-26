import { describe, expect, test } from "bun:test";
import { QueueMemoryProvider } from "./provider.ts";

describe("QueueMemoryProvider", () => {
  test("basic enqueue + dequeue + ack", async () => {
    const q = new QueueMemoryProvider();
    const id = await q.enqueue({
      deploymentId: "d1",
      blueprintId: "demo/echo",
      triggeredBy: "manual",
    });
    const claimed = await q.dequeue("w1", 5000);
    expect(claimed?.runId).toBe(id);
    await q.ack(id);
    const depth = await q.depth();
    expect(depth.queued + depth.running).toBe(0);
  });
});
