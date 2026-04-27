// Boot-time reconciliation: TOML is authoritative.
// Upserts rows from [providers.*.*] and [roles.*] with source='config',
// then deletes any source='config' rows in DB that no longer appear in TOML.
// source='dashboard' rows are untouched.

import type { EngineModelRoleRecord, ProviderCredentialRecord, StateProvider } from "@oddjob/core";

import type { OddjobConfig } from "./config.ts";

export interface ReconcileResult {
  providersUpserted: number;
  providersDeleted: number;
  rolesUpserted: number;
  rolesDeleted: number;
}

export async function reconcileConfigToDb(
  state: StateProvider,
  cfg: OddjobConfig,
): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    providersUpserted: 0,
    providersDeleted: 0,
    rolesUpserted: 0,
    rolesDeleted: 0,
  };

  // ── Providers ─────────────────────────────────────────────────────────
  const tomlCreds = new Set<string>();
  const now = Date.now();
  for (const [slug, byName] of Object.entries(cfg.providers ?? {})) {
    for (const [credName, body] of Object.entries(byName)) {
      tomlCreds.add(`${slug}::${credName}`);
      const existing = await state.getProviderCredential(slug, credName);
      const record: ProviderCredentialRecord = {
        providerSlug: slug,
        credentialName: credName,
        apiKeySecret: body.api_key_secret,
        optionsJson: body.options ? JSON.stringify(body.options) : undefined,
        source: "config",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await state.upsertProviderCredential(record);
      result.providersUpserted++;
    }
  }
  // Delete config-sourced rows no longer in TOML.
  const allCreds = await state.listProviderCredentials();
  for (const c of allCreds) {
    if (c.source !== "config") continue;
    if (tomlCreds.has(`${c.providerSlug}::${c.credentialName}`)) continue;
    await state.deleteProviderCredential(c.providerSlug, c.credentialName);
    result.providersDeleted++;
  }

  // ── Roles ────────────────────────────────────────────────────────────
  const tomlRoles = new Set<string>();
  for (const [role, body] of Object.entries(cfg.roles ?? {})) {
    tomlRoles.add(role);
    const record: EngineModelRoleRecord = {
      role,
      providerSlug: body.provider,
      modelId: body.model,
      credentialName: body.credential ?? "default",
      optionsJson: body.options ? JSON.stringify(body.options) : undefined,
      source: "config",
      updatedAt: now,
    };
    await state.upsertEngineModelRole(record);
    result.rolesUpserted++;
  }
  const allRoles = await state.listEngineModelRoles();
  for (const r of allRoles) {
    if (r.source !== "config") continue;
    if (tomlRoles.has(r.role)) continue;
    await state.deleteEngineModelRole(r.role);
    result.rolesDeleted++;
  }

  // ── Plugins disabled list ────────────────────────────────────────────
  const disabled = new Set(cfg.plugins?.disabled ?? []);
  const installed = await state.listPlugins();
  for (const p of installed) {
    const shouldBeEnabled = !disabled.has(p.slug);
    if (p.enabled !== shouldBeEnabled) {
      await state.setPluginEnabled(p.slug, shouldBeEnabled);
    }
  }

  return result;
}
