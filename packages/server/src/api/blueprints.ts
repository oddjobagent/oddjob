import { BlueprintVersionExistsError } from "@oddjob/core";

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
  /** Extra tags to move to this version (in addition to the always-moved `latest`). */
  promoteTags?: string[];
  /** Overwrite an existing (id, version) row instead of returning 409. */
  force?: boolean;
}

interface SetTagBody {
  version: string;
}

export const list =
  (rt: Runtime): Handler =>
  async () => {
    const items = await rt.state.listBlueprints();
    return json({ blueprints: items });
  };

export const get =
  (rt: Runtime): Handler =>
  async (req, ctx) => {
    const id = `${ctx.params.namespace}/${ctx.params.name}`;
    const url = new URL(req.url);
    const tag = url.searchParams.get("tag") ?? undefined;
    const version = url.searchParams.get("version") ?? undefined;
    const bp = await rt.state.getBlueprint(id, { tag, version });
    if (!bp) return notFound(`blueprint ${id} not found`);
    return json(bp);
  };

export const push =
  (rt: Runtime): Handler =>
  async (req) => {
    const body = await readJson<PushBody>(req);
    if (!body) return badRequest("body required");
    const url = new URL(req.url);
    const force = body.force === true || url.searchParams.get("force") === "1";
    const promoteTags = Array.isArray(body.promoteTags)
      ? body.promoteTags.filter((t): t is string => typeof t === "string" && t.length > 0)
      : [];
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
    try {
      await rt.state.upsertBlueprint(bp, { force, tags: promoteTags });
    } catch (err) {
      if (err instanceof BlueprintVersionExistsError) {
        return json(
          {
            error: "blueprint_version_exists",
            blueprintId: err.blueprintId,
            version: err.version,
            hint: "use ?force=1 (or { force: true }) to overwrite, or bump the version field",
          },
          { status: 409 },
        );
      }
      throw err;
    }
    return json(bp, { status: 201 });
  };

export const remove =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const id = `${ctx.params.namespace}/${ctx.params.name}`;
    await rt.state.deleteBlueprint(id);
    return new Response(null, { status: 204 });
  };

export const listVersions =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const id = `${ctx.params.namespace}/${ctx.params.name}`;
    const versions = await rt.state.listBlueprintVersions(id);
    return json({ versions });
  };

export const listTags =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const id = `${ctx.params.namespace}/${ctx.params.name}`;
    const tags = await rt.state.listBlueprintTags(id);
    return json({ tags });
  };

export const setTag =
  (rt: Runtime): Handler =>
  async (req, ctx) => {
    const id = `${ctx.params.namespace}/${ctx.params.name}`;
    const tag = ctx.params.tag;
    if (!tag) return badRequest("tag required");
    const body = await readJson<SetTagBody>(req);
    if (!body?.version) return badRequest("body.version required");
    try {
      await rt.state.setBlueprintTag(id, tag, body.version);
    } catch (err) {
      return badRequest((err as Error).message);
    }
    return json({ id, tag, version: body.version });
  };

export const removeTag =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const id = `${ctx.params.namespace}/${ctx.params.name}`;
    const tag = ctx.params.tag;
    if (!tag) return badRequest("tag required");
    try {
      await rt.state.deleteBlueprintTag(id, tag);
    } catch (err) {
      return badRequest((err as Error).message);
    }
    return new Response(null, { status: 204 });
  };
