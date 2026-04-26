import type { RunConfig } from "../types/run.ts";
import type { Provider } from "./base.ts";

export interface QueueProvider extends Provider {
  enqueue(config: RunConfig): Promise<string>;
  dequeue(workerId: string, leaseMs: number): Promise<QueuedRun | null>;
  heartbeat(runId: string, workerId: string): Promise<void>;
  ack(runId: string, workerId: string): Promise<AckResult>;
  nack(runId: string, workerId: string, error?: string): Promise<AckResult>;
  reclaimStale(): Promise<number>;
  depth(): Promise<QueueDepth>;
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
