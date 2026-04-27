// /api/v1/config — resolved view of the engine config + reload trigger.
//
// GET returns the merged TOML+DB shape (with secret values stripped — only
// secret refs are returned). POST /reload re-reads the TOML and re-runs
// reconciliation so dashboard mutations immediately reflect after a manual
// edit to ~/.oddjob/config.toml.

import { json, serverError, type Handler } from "../middleware/index.ts";
import type { Runtime } from "../runtime.ts";

export const get =
  (rt: Runtime): Handler =>
  async () => {
    const [creds, roles, plugins] = await Promise.all([
      rt.state.listProviderCredentials(),
      rt.state.listEngineModelRoles(),
      rt.state.listPlugins(),
    ]);
    return json({
      providers: creds.map((c) => ({
        providerSlug: c.providerSlug,
        credentialName: c.credentialName,
        apiKeySecret: c.apiKeySecret,
        hasOptions: !!c.optionsJson,
        source: c.source,
        updatedAt: c.updatedAt,
      })),
      roles: roles.map((r) => ({
        role: r.role,
        providerSlug: r.providerSlug,
        modelId: r.modelId,
        credentialName: r.credentialName,
        source: r.source,
        updatedAt: r.updatedAt,
      })),
      plugins: plugins.map((p) => ({
        slug: p.slug,
        version: p.version,
        source: p.source,
        enabled: p.enabled,
      })),
      hooks: {
        persistConfig: !!rt.persistConfig,
        reloadConfig: !!rt.reloadConfig,
      },
    });
  };

export const reload =
  (rt: Runtime): Handler =>
  async () => {
    if (!rt.reloadConfig) {
      return serverError(new Error("runtime has no reloadConfig hook"));
    }
    try {
      await rt.reloadConfig();
    } catch (err) {
      return serverError(err);
    }
    return json({ ok: true });
  };
