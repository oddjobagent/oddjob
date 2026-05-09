import type { StepKind } from "@oddjob/core";

import type { Runtime } from "../runtime.ts";
import type { WorkerPool } from "../workers/pool.ts";
import { type Handler, badRequest, json, notFound, readJson } from "../middleware/index.ts";

const STEP_KINDS: ReadonlySet<StepKind> = new Set([
  "llm_call",
  "tool_call",
  "grader",
  "verdict",
  "compaction",
  "classifier",
  "subagent",
]);

export const list =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const limit = Number(ctx.url.searchParams.get("limit") ?? "50");
    const deploymentId = ctx.url.searchParams.get("deployment_id") ?? undefined;
    const rows = await rt.state.listRuns({ deploymentId, limit });
    return json({ runs: rows });
  };

export const get =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const r = await rt.state.getRun(ctx.params.id ?? "");
    if (!r) return notFound("run not found");
    return json(r);
  };

export const logs =
  (rt: Runtime): Handler =>
  async (req, ctx) => {
    const id = ctx.params.id ?? "";
    const since = Number(ctx.url.searchParams.get("since") ?? "0");
    const limit = Number(ctx.url.searchParams.get("limit") ?? "1000");
    const stream = ctx.url.searchParams.get("stream") === "1";
    if (stream) return streamLogs(rt, id, since, req);
    const entries = await rt.log.getLogs(id, { since, limit });
    return json({ entries });
  };

function streamLogs(rt: Runtime, runId: string, sinceParam: number, req: Request): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      let since = sinceParam;
      let closed = false;
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, 15_000);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", close);

      while (!closed) {
        const fresh = await rt.log
          .getLogs(runId, { since, limit: 500 })
          .catch((): import("@oddjob/core").LogEntry[] => []);
        if (closed) break;
        for (const entry of fresh) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`));
          if (entry.timestamp >= since) since = entry.timestamp + 1;
        }
        // Stop streaming once the run is in a terminal state and we've drained.
        const run = await rt.state.getRun(runId).catch(() => null);
        if (run && run.status !== "running" && run.status !== "queued" && fresh.length === 0) {
          controller.enqueue(encoder.encode("event: end\ndata: {}\n\n"));
          close();
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-store",
      connection: "keep-alive",
    },
  });
}

export const steps =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const id = ctx.params.id ?? "";
    if (!rt.step) return json({ steps: [] });
    const since = Number(ctx.url.searchParams.get("since") ?? "0");
    const limit = Number(ctx.url.searchParams.get("limit") ?? "1000");
    const kindParam = ctx.url.searchParams.get("kind") ?? undefined;
    const query: { since: number; limit: number; kind?: StepKind } = { since, limit };
    if (kindParam) {
      if (!STEP_KINDS.has(kindParam as StepKind)) {
        return badRequest(`unknown step kind: ${kindParam}`);
      }
      query.kind = kindParam as StepKind;
    }
    const rows = await rt.step.getSteps(id, query);
    return json({ steps: rows });
  };

export const children =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const id = ctx.params.id ?? "";
    const limit = Number(ctx.url.searchParams.get("limit") ?? "200");
    // Existence check so the dashboard surfaces 404 instead of empty children
    // for a typo'd run id. listRuns(parentRunId=...) returns [] when the id
    // exists but has no children (top-level), which is also the empty state.
    const parent = await rt.state.getRun(id);
    if (!parent) return notFound("run not found");
    const rows = await rt.state.listRuns({ parentRunId: id, limit });
    return json({ children: rows });
  };

export const cancel =
  (rt: Runtime, workers: WorkerPool): Handler =>
  async (_req, ctx) => {
    const id = ctx.params.id ?? "";
    const run = await rt.state.getRun(id);
    if (!run) return notFound("run not found");
    if (run.status !== "queued" && run.status !== "running") {
      return json({ runId: id, result: "noop", status: run.status });
    }
    const result = await workers.cancelRun(id);
    return json({ runId: id, result });
  };

interface ConfirmBody {
  tool_use_id?: string;
  toolUseId?: string;
  result?: "allow" | "deny";
  deny_message?: string;
  denyMessage?: string;
}

export const listConfirmations =
  (_rt: Runtime, workers: WorkerPool): Handler =>
  async (_req, ctx) => {
    const id = ctx.params.id ?? "";
    return json({ pending: workers.pendingConfirmationsFor(id) });
  };

export const confirm =
  (rt: Runtime, workers: WorkerPool): Handler =>
  async (req, ctx) => {
    const id = ctx.params.id ?? "";
    const body = await readJson<ConfirmBody>(req);
    if (!body) return badRequest("body required");
    const toolUseId = body.tool_use_id ?? body.toolUseId;
    if (!toolUseId) return badRequest("tool_use_id required");
    if (body.result !== "allow" && body.result !== "deny") {
      return badRequest('result must be "allow" or "deny"');
    }
    const run = await rt.state.getRun(id);
    if (!run) return notFound("run not found");
    const outcome = workers.confirmTool(id, toolUseId, {
      allow: body.result === "allow",
      denyMessage: body.deny_message ?? body.denyMessage,
    });
    if (!outcome.ok) return badRequest(outcome.reason ?? "no pending confirmation");
    return json({ runId: id, toolUseId, result: body.result });
  };

// COMPOSABLE_BLUEPRINTS Phase 2 — script-mode `ctx.requestApproval` resolution.
// Mirrors the confirm flow but at the run level (one pending approval per run).

interface ApprovalBody {
  approved: boolean;
  reason?: string;
  resolver?: string;
}

export const getApproval =
  (rt: Runtime, workers: WorkerPool): Handler =>
  async (_req, ctx) => {
    const id = ctx.params.id ?? "";
    const run = await rt.state.getRun(id);
    if (!run) return notFound("run not found");
    const pending = workers.pendingApprovalFor(id);
    return json({ pending: pending ?? null });
  };

export const resolveApproval =
  (rt: Runtime, workers: WorkerPool): Handler =>
  async (req, ctx) => {
    const id = ctx.params.id ?? "";
    const body = await readJson<ApprovalBody>(req);
    if (!body) return badRequest("body required");
    if (typeof body.approved !== "boolean") {
      return badRequest("approved (boolean) required");
    }
    const run = await rt.state.getRun(id);
    if (!run) return notFound("run not found");
    const outcome = workers.resolveApproval(id, {
      approved: body.approved,
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
      ...(body.resolver !== undefined ? { resolver: body.resolver } : {}),
    });
    if (!outcome.ok) return badRequest(outcome.reason ?? "no pending approval");
    return json({ runId: id, approved: body.approved });
  };
