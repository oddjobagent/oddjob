import { randomUUID } from "node:crypto";

import type { QueueDepth, QueueProvider, QueuedRun, RunConfig } from "@oddjob/core";

interface Slot {
  runId: string;
  config: RunConfig;
  status: "queued" | "running" | "failed";
  workerId?: string;
  leasedUntil?: number;
  attempts: number;
  enqueuedAt: number;
}

export class QueueMemoryProvider implements QueueProvider {
  readonly name = "queue-memory";
  private slots = new Map<string, Slot>();

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return true;
  }

  async enqueue(config: RunConfig): Promise<string> {
    const runId = randomUUID();
    this.slots.set(runId, { runId, config, status: "queued", attempts: 0, enqueuedAt: Date.now() });
    return runId;
  }

  async dequeue(workerId: string, leaseMs: number): Promise<QueuedRun | null> {
    const now = Date.now();
    const candidate = [...this.slots.values()]
      .filter(
        (s) => s.status === "queued" || (s.status === "running" && (s.leasedUntil ?? 0) < now),
      )
      .sort((a, b) => a.enqueuedAt - b.enqueuedAt)[0];
    if (!candidate) return null;
    candidate.status = "running";
    candidate.workerId = workerId;
    candidate.leasedUntil = now + leaseMs;
    candidate.attempts++;
    return {
      runId: candidate.runId,
      config: candidate.config,
      attempts: candidate.attempts,
      leasedUntil: candidate.leasedUntil,
    };
  }

  async heartbeat(runId: string, workerId: string): Promise<void> {
    const slot = this.slots.get(runId);
    if (slot && slot.workerId === workerId && slot.status === "running") {
      slot.leasedUntil = Date.now() + 30_000;
    }
  }

  async ack(runId: string): Promise<void> {
    this.slots.delete(runId);
  }

  async nack(runId: string, _error?: string): Promise<void> {
    const slot = this.slots.get(runId);
    if (slot) {
      slot.status = "failed";
      slot.workerId = undefined;
      slot.leasedUntil = undefined;
    }
  }

  async reclaimStale(): Promise<number> {
    const now = Date.now();
    let n = 0;
    for (const s of this.slots.values()) {
      if (s.status === "running" && (s.leasedUntil ?? 0) < now) {
        s.status = "queued";
        s.workerId = undefined;
        s.leasedUntil = undefined;
        n++;
      }
    }
    return n;
  }

  async depth(): Promise<QueueDepth> {
    const out: QueueDepth = { queued: 0, running: 0, failed: 0 };
    for (const s of this.slots.values()) {
      out[s.status]++;
    }
    return out;
  }
}
