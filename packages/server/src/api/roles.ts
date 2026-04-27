// /api/v1/roles — engine-wide role assignments. Reads/writes
// `engine_model_roles` and reloads the in-memory snapshot so dispatch picks
// up the change without a restart.

import { badRequest, json, notFound, readJson, type Handler } from "../middleware/index.ts";
import type { Runtime } from "../runtime.ts";

export const list =
  (rt: Runtime): Handler =>
  async () => {
    const rows = await rt.state.listEngineModelRoles();
    return json({
      roles: rows.map((r) => ({
        role: r.role,
        providerSlug: r.providerSlug,
        modelId: r.modelId,
        credentialName: r.credentialName,
        source: r.source,
        updatedAt: r.updatedAt,
      })),
    });
  };

interface RoleSetBody {
  providerSlug: string;
  modelId: string;
  credentialName?: string;
  options?: Record<string, unknown>;
}

export const set =
  (rt: Runtime): Handler =>
  async (req, ctx) => {
    const role = ctx.params.role ?? "";
    if (!role) return badRequest("role missing");
    const body = await readJson<RoleSetBody>(req);
    if (!body) return badRequest("body required");
    if (!body.providerSlug || !body.modelId) {
      return badRequest("providerSlug and modelId are required");
    }
    if (!rt.plugins.providerFor(body.providerSlug)) {
      return badRequest(`provider '${body.providerSlug}' is not registered`);
    }
    await rt.state.upsertEngineModelRole({
      role,
      providerSlug: body.providerSlug,
      modelId: body.modelId,
      credentialName: body.credentialName ?? "default",
      optionsJson: body.options ? JSON.stringify(body.options) : undefined,
      source: "config",
      updatedAt: Date.now(),
    });
    if (rt.reloadRoles) await rt.reloadRoles();
    const persistError = await tryPersist(rt);
    return json({ role, ok: true, ...persistError });
  };

export const remove =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const role = ctx.params.role ?? "";
    const existing = await rt.state.getEngineModelRole(role);
    if (!existing) return notFound(`role '${role}' has no assignment`);
    await rt.state.deleteEngineModelRole(role);
    if (rt.reloadRoles) await rt.reloadRoles();
    const persistError = await tryPersist(rt);
    return json({ role, ok: true, ...persistError });
  };

async function tryPersist(
  rt: Runtime,
): Promise<{ tomlPersistFailed?: true; tomlPersistError?: string }> {
  if (!rt.persistConfig) return {};
  try {
    await rt.persistConfig();
    return {};
  } catch (err) {
    const message = (err as Error).message;
    console.warn(`[oddjob] persistConfig failed: ${message}`);
    return { tomlPersistFailed: true, tomlPersistError: message };
  }
}
