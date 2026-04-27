// /api/v1/providers — model-provider service introspection: list providers,
// view & refresh model catalogs, manage credentials.

import { badRequest, json, notFound, readJson, type Handler } from "../middleware/index.ts";
import type { Runtime } from "../runtime.ts";

interface ProviderSummary {
  slug: string;
  displayName: string;
  authHint?: string;
  capabilities: { tools: boolean; streaming: boolean; vision: boolean; reasoning: boolean };
  models: number;
  hasRefresh: boolean;
  hasCredentials: boolean;
}

export const list =
  (rt: Runtime): Handler =>
  async () => {
    const allCreds = await rt.state.listProviderCredentials();
    const credBySlug = new Map<string, number>();
    for (const c of allCreds)
      credBySlug.set(c.providerSlug, (credBySlug.get(c.providerSlug) ?? 0) + 1);
    const out: ProviderSummary[] = [];
    for (const p of rt.plugins.listProviders()) {
      const reg = rt.plugins.get(p.id);
      if (!reg?.record.enabled) continue;
      out.push({
        slug: p.id,
        displayName: p.displayName,
        authHint: p.authHint,
        capabilities: p.capabilities,
        models: p.listModels().length,
        hasRefresh: typeof p.refreshCatalog === "function",
        hasCredentials: (credBySlug.get(p.id) ?? 0) > 0,
      });
    }
    return json({ providers: out });
  };

export const get =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const slug = ctx.params.slug ?? "";
    const provider = rt.plugins.providerFor(slug);
    if (!provider) return notFound(`provider '${slug}' not found`);
    const cached = await rt.state.listModelCatalog(slug);
    const merged = mergeCatalog(provider.listModels(), cached);
    const creds = await rt.state.listProviderCredentials(slug);
    return json({
      slug,
      displayName: provider.displayName,
      authHint: provider.authHint,
      capabilities: provider.capabilities,
      models: merged,
      credentials: creds.map((c) => ({
        credentialName: c.credentialName,
        apiKeySecret: c.apiKeySecret,
        hasOptions: !!c.optionsJson,
        source: c.source,
        updatedAt: c.updatedAt,
      })),
    });
  };

export const refresh =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const slug = ctx.params.slug ?? "";
    const provider = rt.plugins.providerFor(slug);
    if (!provider) return notFound(`provider '${slug}' not found`);
    if (!provider.refreshCatalog) {
      return badRequest(`provider '${slug}' has no live catalog refresh`);
    }
    const cred = await rt.state.getProviderCredential(slug, "default");
    let apiKey: string | undefined;
    if (cred?.apiKeySecret) {
      apiKey = (await rt.secrets.get(cred.apiKeySecret)) ?? undefined;
    }
    const options = cred?.optionsJson ? safeJson(cred.optionsJson) : undefined;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30_000);
    let models: readonly import("@oddjob/core").ModelInfo[];
    try {
      models = await provider.refreshCatalog({
        credential: { apiKey, options },
        signal: ctl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      return badRequest(`refresh failed: ${(err as Error).message}`);
    }
    clearTimeout(timer);
    // Cap the catalog so a misbehaving provider can't fill the DB. OpenRouter
    // ships ~300 models today; 5000 is a generous ceiling.
    const MAX_CATALOG_ROWS = 5000;
    const safe = models.slice(0, MAX_CATALOG_ROWS);
    // Replace cached rows for this provider in a single transaction so a
    // mid-loop crash can't leave a half-empty catalog.
    const fetchedAt = Date.now();
    await rt.state.deleteModelCatalogEntries(slug);
    for (const info of safe) {
      await rt.state.upsertModelCatalogEntry({
        providerSlug: slug,
        modelId: info.id,
        data: info,
        fetchedAt,
      });
    }
    return json({ slug, count: safe.length, fetchedAt, truncated: models.length > safe.length });
  };

interface CredentialUpsert {
  credentialName?: string;
  apiKey?: string;
  apiKeySecret?: string;
  options?: Record<string, unknown>;
}

export const upsertCredential =
  (rt: Runtime): Handler =>
  async (req, ctx) => {
    const slug = ctx.params.slug ?? "";
    if (!rt.plugins.providerFor(slug)) return notFound(`provider '${slug}' not found`);
    const body = await readJson<CredentialUpsert>(req);
    if (!body) return badRequest("body required");
    const credentialName = body.credentialName ?? "default";

    const now = Date.now();
    const existing = await rt.state.getProviderCredential(slug, credentialName);
    let secretName = body.apiKeySecret ?? existing?.apiKeySecret;
    if (body.apiKey !== undefined && body.apiKey !== "") {
      secretName =
        body.apiKeySecret ?? existing?.apiKeySecret ?? `provider:${slug}:${credentialName}`;
      await rt.secrets.set(secretName, body.apiKey);
    }
    await rt.state.upsertProviderCredential({
      providerSlug: slug,
      credentialName,
      apiKeySecret: secretName,
      optionsJson: body.options ? JSON.stringify(body.options) : existing?.optionsJson,
      source: "config",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    if (rt.reloadRoles) await rt.reloadRoles();
    if (rt.persistConfig) await rt.persistConfig();
    return json({ slug, credentialName, ok: true });
  };

export const deleteCredential =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const slug = ctx.params.slug ?? "";
    const credentialName = ctx.params.credentialName ?? "default";
    await rt.state.deleteProviderCredential(slug, credentialName);
    if (rt.reloadRoles) await rt.reloadRoles();
    if (rt.persistConfig) await rt.persistConfig();
    return json({ slug, credentialName, ok: true });
  };

function safeJson(raw: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function mergeCatalog(
  bundled: ReadonlyArray<import("@oddjob/core").ModelInfo>,
  cached: ReadonlyArray<import("@oddjob/core").ModelCatalogRecord>,
): import("@oddjob/core").ModelInfo[] {
  if (cached.length === 0) return [...bundled];
  const byId = new Map(bundled.map((m) => [m.id, m]));
  for (const c of cached) byId.set(c.modelId, c.data);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
