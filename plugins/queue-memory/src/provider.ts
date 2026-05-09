import type { AckResult, QueueDepth, QueueProvider, QueuedRun, RunConfig } from "@oddjob/core";
import { newId } from "@oddjob/core";

interface Slot {
  runId: string;
  config: RunConfig;
  status: "queued" | "running" | "failed";
  workerId?: string;
  leasedUntil?: number;
  attempts: number;
  enqueuedAt: number;
  availableAt: number;
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
    const runId = newId("run");
    const now = Date.now();
    this.slots.set(runId, {
      runId,
      config,
      status: "queued",
      attempts: 0,
      enqueuedAt: now,
      availableAt: 0,
    });
    return runId;
  }

  async dequeue(workerId: string, leaseMs: number): Promise<QueuedRun | null> {
    const now = Date.now();
    const candidate = [...this.slots.values()]
      .filter(
        (s) =>
          (s.status === "queued" && s.availableAt <= now) ||
          (s.status === "running" && (s.leasedUntil ?? 0) < now),
      )
      .toSorted((a, b) => a.enqueuedAt - b.enqueuedAt)[0];
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

  async ack(runId: string, workerId: string): Promise<AckResult> {
    const slot = this.slots.get(runId);
    if (!slot || slot.workerId !== workerId || slot.status !== "running") return "lease_lost";
    this.slots.delete(runId);
    return "ok";
  }

  async nack(runId: string, workerId: string, _error?: string): Promise<AckResult> {
    const slot = this.slots.get(runId);
    if (!slot || slot.workerId !== workerId || slot.status !== "running") return "lease_lost";
    slot.status = "failed";
    slot.workerId = undefined;
    slot.leasedUntil = undefined;
    return "ok";
  }

  async requeue(runId: string, workerId: string, delayMs: number): Promise<AckResult> {
    const slot = this.slots.get(runId);
    if (!slot || slot.workerId !== workerId || slot.status !== "running") return "lease_lost";
    slot.status = "queued";
    slot.workerId = undefined;
    slot.leasedUntil = undefined;
    slot.availableAt = Date.now() + Math.max(0, delayMs);
    return "ok";
  }

  async cancel(runId: string): Promise<boolean> {
    const slot = this.slots.get(runId);
    if (!slot || slot.status !== "queued") return false;
    this.slots.delete(runId);
    return true;
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
