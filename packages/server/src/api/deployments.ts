import type { DeploymentInput, DeploymentStatus } from "@oddjob/core";

import type { Runtime } from "../runtime.ts";
import {
  type Handler,
  badRequest,
  conflict,
  json,
  notFound,
  readJson,
} from "../middleware/index.ts";

export const list =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const includeArchived = ctx.url.searchParams.get("include_archived") === "1";
    const list = await rt.state.listDeployments({ includeArchived });
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
    const tag = body.blueprintTag ?? "latest";
    const bp = await rt.state.getBlueprint(body.blueprintId, { tag });
    if (!bp) {
      return badRequest(
        `blueprint ${body.blueprintId}:${tag} not found - push first or pick a known tag`,
      );
    }
    const existing = await rt.state.getDeploymentByName(body.name);
    if (existing) return conflict(`deployment name '${body.name}' already in use`);

    const required = bp.requires?.roles ?? [];
    if (required.length > 0) {
      const missing: string[] = [];
      for (const role of required) {
        const ok = rt.roleResolver.hasRole(
          role,
          body.modelRoleOverrides
            ? Object.fromEntries(
                Object.entries(body.modelRoleOverrides).map(([r, o]) => [
                  r,
                  {
                    providerSlug: o.providerSlug,
                    modelId: o.modelId,
                    credentialName: o.credentialName ?? "default",
                    options: o.options,
                  },
                ]),
              )
            : undefined,
          bp.model,
        );
        if (!ok) missing.push(role);
      }
      if (missing.length > 0) {
        return badRequest(
          `blueprint ${bp.id} requires roles [${missing.join(", ")}] — assign them via 'oddjob roles set' or modelRoleOverrides`,
        );
      }
    }

    const dep = await rt.state.createDeployment({ ...body, blueprintTag: tag });
    if (rt.scheduler) await registerCronTriggers(rt, dep.id);
    return json(dep, { status: 201 });
  };

export const update =
  (rt: Runtime): Handler =>
  async (req, ctx) => {
    const body = await readJson<Partial<DeploymentInput & { status: DeploymentStatus }>>(req);
    if (!body) return badRequest("body required");
    const id = ctx.params.id ?? "";
    if (body.name) {
      const existing = await rt.state.getDeploymentByName(body.name);
      if (existing && existing.id !== id) {
        return conflict(`deployment name '${body.name}' already in use`);
      }
    }
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
    // DELETE is now a soft archive (Phase 15). State provider's deleteDeployment
    // sets status='archived' rather than dropping the row.
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
    if (dep.status === "archived" || dep.status === "disabled") {
      return badRequest(`deployment ${dep.name} is ${dep.status}; resume to run`);
    }
    const body = (await readJson<{ input?: unknown }>(req)) ?? {};
    const runId = await rt.queue.enqueue({
      deploymentId: dep.id,
      blueprintId: dep.blueprintId,
      triggeredBy: "manual",
      input: body.input,
    });
    return json({ run_id: runId }, { status: 202 });
  };

export const pause =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const id = ctx.params.id ?? "";
    const dep = await rt.state.getDeployment(id);
    if (!dep) return notFound("deployment not found");
    if (dep.status === "archived") return badRequest("cannot pause an archived deployment");
    if (rt.scheduler) await rt.scheduler.unschedule(id);
    const updated = await rt.state.updateDeployment(id, { status: "paused" });
    return json(updated);
  };

export const resume =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const id = ctx.params.id ?? "";
    const dep = await rt.state.getDeployment(id);
    if (!dep) return notFound("deployment not found");
    if (dep.status === "archived") return badRequest("unarchive before resuming");
    const updated = await rt.state.updateDeployment(id, { status: "active" });
    if (rt.scheduler) await registerCronTriggers(rt, id);
    return json(updated);
  };

export const archive =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const id = ctx.params.id ?? "";
    const dep = await rt.state.getDeployment(id);
    if (!dep) return notFound("deployment not found");
    if (rt.scheduler) await rt.scheduler.unschedule(id);
    const updated = await rt.state.updateDeployment(id, { status: "archived" });
    return json(updated);
  };

export const unarchive =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const id = ctx.params.id ?? "";
    const dep = await rt.state.getDeployment(id);
    if (!dep) return notFound("deployment not found");
    if (dep.status !== "archived") return badRequest("deployment is not archived");
    const updated = await rt.state.updateDeployment(id, { status: "paused" });
    // Restore as paused so the user explicitly resumes (avoids surprise cron
    // firing immediately after un-archive).
    return json(updated);
  };

export const nextRun =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const id = ctx.params.id ?? "";
    const dep = await rt.state.getDeployment(id);
    if (!dep) return notFound("deployment not found");
    if (!rt.scheduler) return json({ deploymentId: id, nextRun: null });
    const next = await rt.scheduler.nextRun(id);
    return json({ deploymentId: id, nextRun: next ? next.getTime() : null });
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
