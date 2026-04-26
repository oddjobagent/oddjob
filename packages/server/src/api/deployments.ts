import type { DeploymentInput } from "@oddjob/core";

import type { Runtime } from "../runtime.ts";
import { type Handler, badRequest, json, notFound, readJson } from "../middleware/index.ts";

export const list =
  (rt: Runtime): Handler =>
  async () => {
    const list = await rt.state.listDeployments();
    return json({ deployments: list });
  };

export const get =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const dep = await rt.state.getDeployment(ctx.params.id ?? "");
    if (!dep) return notFound("deployment not found");
    return json(dep);
  };

export const create =
  (rt: Runtime): Handler =>
  async (req) => {
    const body = await readJson<DeploymentInput>(req);
    if (!body || !body.name || !body.blueprintId) {
      return badRequest("body must include name + blueprintId");
    }
    const bp = await rt.state.getBlueprint(body.blueprintId);
    if (!bp) return badRequest(`blueprint ${body.blueprintId} not found - push first`);
    const dep = await rt.state.createDeployment(body);
    if (rt.scheduler) await registerCronTriggers(rt, dep.id);
    return json(dep, { status: 201 });
  };

export const update =
  (rt: Runtime): Handler =>
  async (req, ctx) => {
    const body =
      await readJson<Partial<DeploymentInput & { status: "active" | "paused" | "disabled" }>>(req);
    if (!body) return badRequest("body required");
    const id = ctx.params.id ?? "";
    const updated = await rt.state.updateDeployment(id, body as never);
    if (rt.scheduler) {
      await rt.scheduler.unschedule(id);
      await registerCronTriggers(rt, id);
    }
    return json(updated);
  };

export const remove =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const id = ctx.params.id ?? "";
    if (rt.scheduler) await rt.scheduler.unschedule(id);
    await rt.state.deleteDeployment(id);
    return new Response(null, { status: 204 });
  };

export const trigger =
  (rt: Runtime): Handler =>
  async (req, ctx) => {
    const id = ctx.params.id ?? "";
    const dep = await rt.state.getDeployment(id);
    if (!dep) return notFound("deployment not found");
    const body = (await readJson<{ input?: unknown }>(req)) ?? {};
    const runId = await rt.queue.enqueue({
      deploymentId: dep.id,
      blueprintId: dep.blueprintId,
      triggeredBy: "manual",
      input: body.input,
    });
    return json({ run_id: runId }, { status: 202 });
  };

async function registerCronTriggers(rt: Runtime, deploymentId: string): Promise<void> {
  if (!rt.scheduler) return;
  const dep = await rt.state.getDeployment(deploymentId);
  if (!dep || dep.status !== "active") return;
  for (const trigger of dep.triggers) {
    if (trigger.type !== "cron") continue;
    await rt.scheduler.schedule(deploymentId, trigger.schedule, trigger.timezone, async () => {
      await rt.queue.enqueue({
        deploymentId: dep.id,
        blueprintId: dep.blueprintId,
        triggeredBy: "cron",
      });
    });
  }
}
