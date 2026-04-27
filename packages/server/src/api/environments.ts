import { parseEnvironment } from "@oddjob/core";

import type { Runtime } from "../runtime.ts";
import { type Handler, badRequest, json, notFound, readJson } from "../middleware/index.ts";

interface UpsertBody {
  toml?: string;
  environment?: unknown;
}

export const list =
  (rt: Runtime): Handler =>
  async () => {
    const environments = await rt.state.listEnvironments();
    return json({ environments });
  };

export const get =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const id = ctx.params.id ?? "";
    const env = await rt.state.getEnvironment(id);
    if (!env) return notFound(`environment ${id} not found`);
    return json(env);
  };

export const upsert =
  (rt: Runtime): Handler =>
  async (req) => {
    const body = await readJson<UpsertBody>(req);
    if (!body) return badRequest("body required");
    let input;
    if (body.toml) {
      input = parseEnvironment(body.toml);
    } else if (body.environment && typeof body.environment === "object") {
      input = body.environment as Parameters<typeof rt.state.upsertEnvironment>[0];
    } else {
      return badRequest("body.toml or body.environment required");
    }
    const env = await rt.state.upsertEnvironment(input);
    return json(env, { status: 201 });
  };

export const remove =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const id = ctx.params.id ?? "";
    await rt.state.deleteEnvironment(id);
    return new Response(null, { status: 204 });
  };

/**
 * GET /api/v1/environments/providers — registered EnvironmentService catalog.
 * Used by the dashboard's environment-create form. Calls each service's
 * `available()` so the UI can render an availability badge.
 */
export const providers =
  (rt: Runtime): Handler =>
  async () => {
    const services = rt.plugins.listEnvironments();
    const out = await Promise.all(
      services.map(async (s) => {
        let availability: { ok: boolean; reason?: string };
        try {
          availability = await s.available();
        } catch (err) {
          availability = { ok: false, reason: (err as Error).message };
        }
        return {
          id: s.id,
          displayName: s.displayName,
          trustTier: s.trustTier,
          authHint: s.authHint,
          capabilities: s.capabilities,
          available: availability,
        };
      }),
    );
    return json({ providers: out });
  };
