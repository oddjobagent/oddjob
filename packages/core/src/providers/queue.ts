import type { RunConfig } from "../types/run.ts";
import type { Provider } from "./base.ts";

export interface QueueProvider extends Provider {
  enqueue(config: RunConfig): Promise<string>;
  dequeue(workerId: string, leaseMs: number): Promise<QueuedRun | null>;
  heartbeat(runId: string, workerId: string): Promise<void>;
  ack(runId: string, workerId: string): Promise<AckResult>;
  nack(runId: string, workerId: string, error?: string): Promise<AckResult>;
  /**
   * Re-queue a currently-running row for a future retry. Resets status to
   * 'queued' and sets `available_at = now + delayMs`. Returns "ok" if the
   * caller still owns the lease, "lease_lost" otherwise (no-op).
   */
  requeue(runId: string, workerId: string, delayMs: number): Promise<AckResult>;
  reclaimStale(): Promise<number>;
  depth(): Promise<QueueDepth>;
  /**
   * Drop a queued run that hasn't been leased yet. Returns true when a row was
   * removed, false when the run is missing or already in flight (caller should
   * fall back to AbortController for in-flight cancellation).
   */
  cancel?(runId: string): Promise<boolean>;
}

export type AckResult = "ok" | "lease_lost";

export interface QueuedRun {
  runId: string;
  config: RunConfig;
  attempts: number;
  leasedUntil: number;
}

export interface QueueDepth {
  queued: number;
  running: number;
  failed: number;
}
