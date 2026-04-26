import type { Runtime } from "../runtime.ts";
import { type Handler, json, notFound } from "../middleware/index.ts";

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
  async (_req, ctx) => {
    const id = ctx.params.id ?? "";
    const since = Number(ctx.url.searchParams.get("since") ?? "0");
    const limit = Number(ctx.url.searchParams.get("limit") ?? "1000");
    const entries = await rt.log.getLogs(id, { since, limit });
    return json({ entries });
  };
