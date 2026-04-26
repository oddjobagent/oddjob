import type { Runtime } from "../runtime.ts";
import { type Handler, badRequest, json, notFound, readJson } from "../middleware/index.ts";

interface PushBody {
  toml: string;
  path?: string;
}

export const list =
  (rt: Runtime): Handler =>
  async () => {
    const items = await rt.state.listBlueprints();
    return json({ blueprints: items });
  };

export const get =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const id = `${ctx.params.namespace}/${ctx.params.name}`;
    const bp = await rt.state.getBlueprint(id);
    if (!bp) return notFound(`blueprint ${id} not found`);
    return json(bp);
  };

export const push =
  (rt: Runtime): Handler =>
  async (req) => {
    const body = await readJson<PushBody>(req);
    if (!body || !body.toml) return badRequest("body.toml required");
    const { parseBlueprint, validateBlueprint } = await import("@oddjob/core");
    const bp = parseBlueprint(body.toml, { path: body.path ?? "<api>" });
    validateBlueprint(bp, { checkFs: false });
    await rt.state.upsertBlueprint(bp);
    return json(bp, { status: 201 });
  };

export const remove =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const id = `${ctx.params.namespace}/${ctx.params.name}`;
    await rt.state.deleteBlueprint(id);
    return new Response(null, { status: 204 });
  };
