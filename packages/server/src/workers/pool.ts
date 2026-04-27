import { randomUUID } from "node:crypto";

import type {
  ChannelConfig,
  EmailChannelConfig,
  ResolvedRoleModel,
  RoleAssignment,
} from "@oddjob/core";
import { createEngineLLM, runOnce } from "@oddjob/core";

import type { Runtime } from "../runtime.ts";
import { renderTemplate, type TemplateContext } from "./template.ts";

function resolveChannelTemplates(ch: ChannelConfig, ctx: TemplateContext): ChannelConfig {
  if (ch.type === "email") {
    const e: EmailChannelConfig = {
      ...ch,
      to: Array.isArray(ch.to)
        ? ch.to.map((t) => renderTemplate(t, ctx))
        : renderTemplate(ch.to, ctx),
      from: ch.from ? renderTemplate(ch.from, ctx) : ch.from,
      subject: ch.subject ? renderTemplate(ch.subject, ctx) : ch.subject,
    };
    return e;
  }
  if (ch.type === "webhook") {
    return { ...ch, url: renderTemplate(ch.url, ctx) };
  }
  if (ch.type === "slack") {
    return { ...ch, target: renderTemplate(ch.target, ctx) };
  }
  return ch;
}

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
  /** Per-run map of pending confirmation requests waiting on user input. */
  pendingConfirmations: Map<string, Map<string, PendingConfirmation>>;
}

interface PendingConfirmation {
  toolName: string;
  args: unknown;
  resolve: (resolution: { allow: boolean; denyMessage?: string }) => void;
  createdAt: number;
}

export interface ConfirmationOutcome {
  ok: boolean;
  reason?: string;
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
      pendingConfirmations: new Map(),
    };
  }

  /**
   * List currently-pending tool-confirmation requests for a run.
   * Used by the dashboard / CLI to render an approval queue.
   */
  pendingConfirmationsFor(
    runId: string,
  ): Array<{ toolUseId: string; toolName: string; args: unknown; createdAt: number }> {
    const map = this.state.pendingConfirmations.get(runId);
    if (!map) return [];
    return [...map.entries()].map(([toolUseId, p]) => ({
      toolUseId,
      toolName: p.toolName,
      args: p.args,
      createdAt: p.createdAt,
    }));
  }

  /**
   * Resolve a pending confirmation. Returns ok=false when no such pending entry
   * exists (already resolved, run finished, etc).
   */
  confirmTool(
    runId: string,
    toolUseId: string,
    result: { allow: boolean; denyMessage?: string },
  ): ConfirmationOutcome {
    const map = this.state.pendingConfirmations.get(runId);
    const entry = map?.get(toolUseId);
    if (!map || !entry) {
      return { ok: false, reason: "no pending confirmation for that tool_use_id" };
    }
    map.delete(toolUseId);
    entry.resolve(result);
    if (map.size === 0) {
      this.state.pendingConfirmations.delete(runId);
      // Flip status back to running so the dashboard reflects the resumed state.
      void this.rt.state.updateRun(runId, { status: "running" });
    }
    return { ok: true };
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
        void this.processRun(next.runId, next.config, next.attempts);
      }
    } catch (err) {
      console.error("[oddjob] poll error:", err);
    } finally {
      this.scheduleNextPoll();
    }
  }

  private async processRun(
    runId: string,
    config: import("@oddjob/core").RunConfig,
    attempts: number,
  ): Promise<void> {
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
      // If a previous worker already inserted this row (lease-loss reclaim path),
      // update the existing row instead of failing on PK conflict.
      const existing = await this.rt.state.getRun(runId).catch(() => null);
      if (existing) {
        await this.rt.state.updateRun(runId, {
          status: "running",
          startedAt,
          error: undefined,
        });
      } else {
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
      }

      await this.rt.log.log(runId, {
        timestamp: startedAt,
        level: "info",
        message: `worker ${this.state.workerId} picked up run`,
        meta: { triggeredBy: config.triggeredBy },
      });

      const dep = await this.rt.state.getDeployment(config.deploymentId);
      if (!dep) throw new Error(`deployment ${config.deploymentId} not found`);
      // Resolve the deployment's pinned tag → exact immutable version.
      // Snapshot both the version label + content hash on the run row so a
      // tag move mid-flight cannot corrupt the historical record.
      const tag = dep.blueprintTag ?? "latest";
      const bp = await this.rt.state.getBlueprint(config.blueprintId, { tag });
      if (!bp) throw new Error(`blueprint ${config.blueprintId}:${tag} not found`);
      await this.rt.state.updateRun(runId, {
        blueprintVersion: bp.version,
        blueprintHash: bp.contentHash,
      });
      await this.rt.log.log(runId, {
        timestamp: Date.now(),
        level: "info",
        message: `resolved ${config.blueprintId}:${tag} -> ${bp.version} (${bp.contentHash.slice(0, 12)})`,
      });

      // Build per-deployment role overrides. The legacy `dep.modelOverride`
      // string maps onto the "default" role for backwards compatibility.
      const overrides = mergeDeploymentOverrides(dep.modelRoleOverrides, dep.modelOverride);
      const engineLlm = createEngineLLM({
        resolver: this.rt.roleResolver,
        blueprint: bp,
        deploymentOverrides: overrides,
      });
      let resolved: ResolvedRoleModel;
      try {
        resolved = await engineLlm.forRole("default");
      } catch (err) {
        throw new Error(
          `model role resolution failed for deployment ${dep.id}: ${(err as Error).message}`,
        );
      }
      // Grader override at blueprint level still wins when set; otherwise the
      // engine's "grader" role (if configured) takes effect inside runOnce.
      let graderResolved: ResolvedRoleModel | undefined;
      if (bp.outcomes?.grader?.model) {
        const secretRef = bp.secrets?.openrouter ?? bp.secrets?.api ?? bp.secrets?.anthropic;
        graderResolved = await this.rt.llm.resolveModel(bp.outcomes.grader.model, secretRef);
      }
      const mergedInput = mergeInput(dep.defaultInput, config.input);

      // Compose dynamic-channel descriptors from the deployment's channel list.
      // Pull each channel's outputContract from its provider so the agent gets
      // the schema fragment in its system prompt + composed output_schema.
      const dynamicChannels = dep.channels
        .filter((c) => c.mode === "dynamic")
        .map((c) => {
          const provider = this.rt.channelFor(c.type);
          return {
            name: c.type,
            type: c.type,
            contract: (provider as { outputContract?: Record<string, unknown> } | undefined)
              ?.outputContract,
          };
        });

      const result = await runOnce({
        blueprint: bp,
        llm: { model: resolved.model, apiKey: resolved.apiKey },
        sandbox: this.rt.sandbox,
        log: this.rt.log,
        mcp: this.rt.mcp,
        secrets: this.rt.secrets,
        auth: this.rt.auth,
        engine: this.rt.engine,
        engineLlm,
        plugins: this.rt.plugins,
        input: mergedInput,
        runId,
        deploymentId: dep.id,
        triggeredBy: config.triggeredBy,
        limits: dep.limits,
        signal: abort.signal,
        dynamicChannels: dynamicChannels.length > 0 ? dynamicChannels : undefined,
        grader: graderResolved
          ? { llm: { model: graderResolved.model, apiKey: graderResolved.apiKey } }
          : undefined,
        onConfirmRequest: async (req) => {
          await this.rt.state.updateRun(runId, { status: "awaiting_confirmation" });
          await this.notifyPendingConfirmation(dep, req);
          return new Promise<{ allow: boolean; denyMessage?: string }>((resolve) => {
            const map =
              this.state.pendingConfirmations.get(runId) ?? new Map<string, PendingConfirmation>();
            map.set(req.toolUseId, {
              toolName: req.toolName,
              args: req.args,
              resolve,
              createdAt: Date.now(),
            });
            this.state.pendingConfirmations.set(runId, map);
          });
        },
      });

      // If this attempt failed but is retry-eligible, persist as `retrying`
      // so the dashboard distinguishes "this attempt failed but harness will
      // try again" from "permanent failure".
      const willRetry =
        result.run.status === "failed" &&
        result.retriable &&
        attempts <= (bp.outcomes?.maxRetries ?? 0);
      const persistedRun: typeof result.run = willRetry
        ? { ...result.run, status: "retrying" }
        : result.run;
      await this.rt.state.updateRun(runId, persistedRun);

      // deliver to channels (with template resolution against input + output)
      const tplCtx = {
        input: mergedInput,
        output: {
          finalText: result.output.finalText,
          structured: result.output.structuredOutput,
        },
        run: {
          id: runId,
          deploymentId: dep.id,
          blueprintId: bp.id,
          startedAt: result.run.startedAt,
          finishedAt: result.run.finishedAt,
          costUsd: result.run.costUsd,
        },
      };
      const channelsBlock = (
        result.output.structuredOutput as { channels?: Record<string, unknown> } | undefined
      )?.channels;
      for (const ch of dep.channels) {
        const provider = this.rt.channelFor(ch.type);
        if (!provider) continue;
        const resolvedCh = resolveChannelTemplates(ch, tplCtx);
        // Dynamic mode: layer agent-emitted overrides over the resolved config
        // and pick a per-channel body if the agent supplied one.
        const dyn =
          ch.mode === "dynamic" && channelsBlock
            ? (channelsBlock[ch.type] as Record<string, unknown> | undefined)
            : undefined;
        const dispatchCh = mergeDynamicOverrides(resolvedCh, dyn);
        const body = pickChannelBody(ch.type, dyn) ?? result.output.finalText;
        try {
          await provider.send({
            body,
            format: "markdown",
            meta: {
              runId,
              deploymentId: dep.id,
              blueprintId: bp.id,
              structured: result.output.structuredOutput,
              channelConfig: dispatchCh,
            },
          });
          await this.rt.log.log(runId, {
            timestamp: Date.now(),
            level: "info",
            message: `channel ${ch.type} delivered`,
            meta: channelLogMeta(dispatchCh),
          });
        } catch (err) {
          await this.rt.log.log(runId, {
            timestamp: Date.now(),
            level: "error",
            message: `channel ${ch.type} delivery failed: ${(err as Error).message}`,
            meta: channelLogMeta(dispatchCh),
          });
        }
      }

      // Branch: success → ack, retriable verdict + budget left → requeue with backoff,
      // anything else → nack (final failure, stays in queue with status='failed').
      const outcomes = bp.outcomes;
      const maxRetries = outcomes?.maxRetries ?? 0;
      const baseBackoff = outcomes?.retryBackoffMs ?? 30_000;
      let queueOp: "ack" | "nack" | "requeue";
      let queueResult: string;
      if (willRetry) {
        const delay = baseBackoff * Math.pow(2, Math.max(0, attempts - 1));
        queueResult = await this.rt.queue.requeue(runId, this.state.workerId, delay);
        queueOp = "requeue";
        await this.rt.log.log(runId, {
          timestamp: Date.now(),
          level: "warn",
          message: `requeued for retry attempt ${attempts + 1}/${maxRetries + 1} in ${delay}ms`,
        });
      } else if (result.run.status === "failed") {
        queueResult = await this.rt.queue.nack(runId, this.state.workerId, result.run.error);
        queueOp = "nack";
      } else {
        queueResult = await this.rt.queue.ack(runId, this.state.workerId);
        queueOp = "ack";
      }
      await this.rt.log.log(runId, {
        timestamp: Date.now(),
        level: queueResult === "ok" ? "info" : "warn",
        message: `run finished status=${result.run.status} ${queueOp}=${queueResult} cost=$${(result.run.costUsd ?? 0).toFixed(6)} attempts=${attempts}`,
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

  /**
   * Cancel an in-flight or queued run.
   * - Running: aborts the AbortController; worker's finally block updates the row.
   * - Queued (no lease yet): drops the queue row and marks the run cancelled.
   */
  async cancelRun(runId: string): Promise<"running" | "queued" | "unknown"> {
    const abort = this.state.abortControllers.get(runId);
    if (abort) {
      abort.abort();
      await this.rt.state.updateRun(runId, {
        status: "cancelled",
        finishedAt: Date.now(),
        error: "cancelled by user",
      });
      return "running";
    }
    const dropped = (await this.rt.queue.cancel?.(runId)) ?? false;
    if (dropped) {
      const existing = await this.rt.state.getRun(runId).catch(() => null);
      if (existing) {
        await this.rt.state.updateRun(runId, {
          status: "cancelled",
          finishedAt: Date.now(),
          error: "cancelled by user",
        });
      }
      return "queued";
    }
    return "unknown";
  }

  private async notifyPendingConfirmation(
    dep: import("@oddjob/core").Deployment,
    req: { runId: string; toolUseId: string; toolName: string; args: unknown },
  ): Promise<void> {
    await this.rt.log.log(req.runId, {
      timestamp: Date.now(),
      level: "warn",
      message: `awaiting confirmation: tool '${req.toolName}' (toolUseId=${req.toolUseId})`,
    });
    // Best-effort notify all configured channels with a short approval prompt.
    const body = [
      `**Approval needed** for run \`${req.runId}\``,
      `deployment: \`${dep.name}\``,
      `tool: \`${req.toolName}\``,
      `args: \`\`\`${JSON.stringify(req.args).slice(0, 400)}\`\`\``,
      "",
      `Approve: \`POST /api/v1/runs/${req.runId}/confirm\` { tool_use_id: "${req.toolUseId}", result: "allow" }`,
      `Deny:    \`POST /api/v1/runs/${req.runId}/confirm\` { tool_use_id: "${req.toolUseId}", result: "deny", deny_message: "..." }`,
    ].join("\n");
    for (const ch of dep.channels) {
      const provider = this.rt.channelFor(ch.type);
      if (!provider) continue;
      try {
        await provider.send({
          body,
          format: "markdown",
          meta: {
            runId: req.runId,
            deploymentId: dep.id,
            kind: "approval_request",
            toolName: req.toolName,
            toolUseId: req.toolUseId,
            channelConfig: ch,
          },
        });
      } catch (err) {
        await this.rt.log.log(req.runId, {
          timestamp: Date.now(),
          level: "warn",
          message: `approval-request channel ${ch.type} delivery failed: ${(err as Error).message}`,
        });
      }
    }
  }
}

/**
 * Layer agent-emitted overrides (`output.structured.channels.<type>`) onto a
 * deploy-time-resolved channel config. Only known fields per channel type are
 * accepted; unknown keys are ignored.
 */
function mergeDynamicOverrides(
  resolved: import("@oddjob/core").ChannelConfig,
  dyn: Record<string, unknown> | undefined,
): import("@oddjob/core").ChannelConfig {
  if (!dyn) return resolved;
  if (resolved.type === "email") {
    const next = { ...resolved };
    if (typeof dyn.subject === "string") next.subject = dyn.subject;
    if (Array.isArray(dyn.to)) next.to = dyn.to.filter((v) => typeof v === "string") as string[];
    return next;
  }
  if (resolved.type === "slack") {
    const next = { ...resolved };
    if (typeof dyn.target === "string") next.target = dyn.target;
    return next;
  }
  if (resolved.type === "webhook") {
    const next = { ...resolved };
    if (typeof dyn.url === "string") next.url = dyn.url;
    if (dyn.headers && typeof dyn.headers === "object" && !Array.isArray(dyn.headers)) {
      next.headers = { ...resolved.headers, ...(dyn.headers as Record<string, string>) };
    }
    return next;
  }
  return resolved;
}

/**
 * If the agent supplied a body field appropriate for the channel type, return
 * it. Otherwise return undefined so the caller falls back to finalText.
 */
function pickChannelBody(
  type: string,
  dyn: Record<string, unknown> | undefined,
): string | undefined {
  if (!dyn) return undefined;
  if (type === "email") {
    if (typeof dyn.body_html === "string") return dyn.body_html;
    if (typeof dyn.body_text === "string") return dyn.body_text;
    return undefined;
  }
  if (type === "slack") {
    if (Array.isArray(dyn.blocks)) return JSON.stringify(dyn.blocks);
    if (typeof dyn.text === "string") return dyn.text;
    return undefined;
  }
  if (type === "webhook") {
    if (dyn.payload !== undefined) return JSON.stringify(dyn.payload);
    return undefined;
  }
  return undefined;
}

function channelLogMeta(ch: import("@oddjob/core").ChannelConfig): Record<string, unknown> {
  if (ch.type === "email") return { type: "email", to: ch.to, from: ch.from, subject: ch.subject };
  if (ch.type === "slack") return { type: "slack", target: ch.target };
  if (ch.type === "webhook") return { type: "webhook", url: ch.url };
  return { type: ch.type };
}

function mergeDeploymentOverrides(
  modelRoleOverrides: Record<string, import("@oddjob/core").ModelRoleOverride> | undefined,
  legacyModelOverride: string | undefined,
): Record<string, RoleAssignment> | undefined {
  const out: Record<string, RoleAssignment> = {};
  if (modelRoleOverrides) {
    for (const [role, ov] of Object.entries(modelRoleOverrides)) {
      out[role] = {
        providerSlug: ov.providerSlug,
        modelId: ov.modelId,
        credentialName: ov.credentialName ?? "default",
        options: ov.options,
      };
    }
  }
  // Legacy: split "openrouter/anthropic/claude-sonnet-4" -> provider+model.
  if (legacyModelOverride && !out.default) {
    const parts = legacyModelOverride.split("/");
    if (parts.length >= 2) {
      out.default = {
        providerSlug: parts[0]!,
        modelId: parts.slice(1).join("/"),
        credentialName: "default",
      };
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mergeInput(defaultInput: unknown, runInput: unknown): unknown {
  if (runInput === undefined || runInput === null) return defaultInput;
  if (defaultInput === undefined || defaultInput === null) return runInput;
  if (
    typeof defaultInput === "object" &&
    !Array.isArray(defaultInput) &&
    typeof runInput === "object" &&
    !Array.isArray(runInput)
  ) {
    return { ...(defaultInput as object), ...(runInput as object) };
  }
  return runInput;
}
