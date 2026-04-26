import { randomUUID } from "node:crypto";

import { runOnce } from "@oddjob/core";

import type { Runtime } from "../runtime.ts";

export interface WorkerPoolOptions {
  runtime: Runtime;
}

interface PoolState {
  running: boolean;
  inFlight: number;
  workerId: string;
  pollHandle?: ReturnType<typeof setTimeout>;
  heartbeats: Map<string, ReturnType<typeof setInterval>>;
  abortControllers: Map<string, AbortController>;
}

export class WorkerPool {
  private readonly rt: Runtime;
  private readonly state: PoolState;

  constructor(opts: WorkerPoolOptions) {
    this.rt = opts.runtime;
    this.state = {
      running: false,
      inFlight: 0,
      workerId: `pool-${process.pid}-${randomUUID().slice(0, 8)}`,
      heartbeats: new Map(),
      abortControllers: new Map(),
    };
  }

  async start(): Promise<void> {
    if (this.state.running) return;
    this.state.running = true;

    // Crash recovery: reclaim any leases stuck from a previous server crash.
    const reclaimed = await this.rt.queue.reclaimStale();
    if (reclaimed > 0) {
      console.warn(`[oddjob] reclaimed ${reclaimed} stale leases on startup`);
    }
    this.scheduleNextPoll();
  }

  async stop(): Promise<void> {
    this.state.running = false;
    if (this.state.pollHandle) clearTimeout(this.state.pollHandle);
    for (const c of this.state.abortControllers.values()) c.abort();
    for (const h of this.state.heartbeats.values()) clearInterval(h);
    this.state.heartbeats.clear();
    this.state.abortControllers.clear();
  }

  private scheduleNextPoll(): void {
    if (!this.state.running) return;
    this.state.pollHandle = setTimeout(() => {
      void this.tick();
    }, this.rt.config.pollMs);
  }

  private async tick(): Promise<void> {
    try {
      while (this.state.running && this.state.inFlight < this.rt.config.maxWorkers) {
        const next = await this.rt.queue.dequeue(this.state.workerId, this.rt.config.leaseMs);
        if (!next) break;
        void this.processRun(next.runId, next.config);
      }
    } catch (err) {
      console.error("[oddjob] poll error:", err);
    } finally {
      this.scheduleNextPoll();
    }
  }

  private async processRun(runId: string, config: import("@oddjob/core").RunConfig): Promise<void> {
    this.state.inFlight++;
    const abort = new AbortController();
    this.state.abortControllers.set(runId, abort);
    const heartbeat = setInterval(() => {
      void this.rt.queue.heartbeat(runId, this.state.workerId);
    }, this.rt.config.heartbeatMs);
    this.state.heartbeats.set(runId, heartbeat);

    const startedAt = Date.now();
    try {
      // Insert running row up-front so callers can poll runs.get(id) before completion.
      await this.rt.state.createRun({
        id: runId,
        deploymentId: config.deploymentId,
        blueprintId: config.blueprintId,
        triggeredBy: config.triggeredBy,
        status: "running",
        input: config.input,
        tokenInput: 0,
        tokenOutput: 0,
        toolCalls: 0,
        startedAt,
        createdAt: startedAt,
      });

      await this.rt.log.log(runId, {
        timestamp: startedAt,
        level: "info",
        message: `worker ${this.state.workerId} picked up run`,
        meta: { triggeredBy: config.triggeredBy },
      });

      const dep = await this.rt.state.getDeployment(config.deploymentId);
      if (!dep) throw new Error(`deployment ${config.deploymentId} not found`);
      const bp = await this.rt.state.getBlueprint(config.blueprintId);
      if (!bp) throw new Error(`blueprint ${config.blueprintId} not found`);

      const secretRef = bp.secrets.openrouter ?? bp.secrets.api ?? bp.secrets.anthropic;
      const resolved = await this.rt.llm.resolveModel(bp.model, secretRef);

      const result = await runOnce({
        blueprint: bp,
        llm: { model: resolved.model, apiKey: resolved.apiKey },
        sandbox: this.rt.sandbox,
        log: this.rt.log,
        mcp: this.rt.mcp,
        secrets: this.rt.secrets,
        input: config.input,
        runId,
        deploymentId: dep.id,
        triggeredBy: config.triggeredBy,
        limits: dep.limits,
        signal: abort.signal,
      });

      await this.rt.state.updateRun(runId, result.run);

      // deliver to channels
      for (const ch of dep.channels) {
        const provider = this.rt.channelFor(ch.type);
        if (!provider) continue;
        try {
          await provider.send({
            body: result.output.finalText,
            format: "markdown",
            meta: {
              runId,
              deploymentId: dep.id,
              blueprintId: bp.id,
              structured: result.output.structuredOutput,
              channelConfig: ch,
            },
          });
        } catch (err) {
          await this.rt.log.log(runId, {
            timestamp: Date.now(),
            level: "error",
            message: `channel ${ch.type} delivery failed: ${(err as Error).message}`,
          });
        }
      }

      const ack = await this.rt.queue.ack(runId, this.state.workerId);
      await this.rt.log.log(runId, {
        timestamp: Date.now(),
        level: ack === "ok" ? "info" : "warn",
        message: `run finished status=${result.run.status} ack=${ack} cost=$${(result.run.costUsd ?? 0).toFixed(6)}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.rt.log.log(runId, {
        timestamp: Date.now(),
        level: "error",
        message: `run failed: ${message}`,
      });
      const existing = await this.rt.state.getRun(runId).catch(() => null);
      if (existing) {
        await this.rt.state.updateRun(runId, {
          status: "failed",
          error: message,
          finishedAt: Date.now(),
        });
      } else {
        await this.rt.state.createRun({
          id: runId,
          deploymentId: config.deploymentId,
          blueprintId: config.blueprintId,
          triggeredBy: config.triggeredBy,
          status: "failed",
          error: message,
          tokenInput: 0,
          tokenOutput: 0,
          toolCalls: 0,
          startedAt,
          finishedAt: Date.now(),
          createdAt: startedAt,
        });
      }
      await this.rt.queue.nack(runId, this.state.workerId, message);
    } finally {
      clearInterval(heartbeat);
      this.state.heartbeats.delete(runId);
      this.state.abortControllers.delete(runId);
      this.state.inFlight--;
    }
  }
}
