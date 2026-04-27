import type { Runtime } from "../runtime.ts";
import { type Handler, badRequest, json, notFound, readJson } from "../middleware/index.ts";

interface PushBody {
  toml?: string;
  path?: string;
  /**
   * Pre-resolved blueprint JSON (CLI sends this when sidecar schemas were
   * resolved at load-time). Server skips TOML parsing and validates directly.
   * `sourceToml` on the blueprint preserves the original TOML for display.
   */
  blueprint?: unknown;
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
    if (!body) return badRequest("body required");
    const { parseBlueprint, validateBlueprint } = await import("@oddjob/core");
    let bp;
    if (body.blueprint && typeof body.blueprint === "object") {
      bp = body.blueprint as Parameters<typeof rt.state.upsertBlueprint>[0];
    } else if (body.toml) {
      bp = parseBlueprint(body.toml, { path: body.path ?? "<api>" });
    } else {
      return badRequest("body.toml or body.blueprint required");
    }
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
