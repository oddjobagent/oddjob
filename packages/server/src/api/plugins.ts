// /api/v1/plugins — list installed plugins, toggle enabled, surface manifest +
// service kinds. Reload requires a server restart in v1; the endpoint flips
// the in-memory enabled flag so dependent endpoints can refuse to serve.

import { json, notFound, type Handler } from "../middleware/index.ts";
import type { Runtime } from "../runtime.ts";

interface PluginSummary {
  slug: string;
  name: string;
  description: string;
  version: string;
  source: string;
  enabled: boolean;
  icon?: string;
  homepage?: string;
  author?: string;
  services: Array<{ kind: string; id?: string; type?: string; name?: string }>;
}

function summarize(rt: Runtime): PluginSummary[] {
  const out: PluginSummary[] = [];
  for (const reg of rt.plugins.list()) {
    const services = reg.plugin.services.map((s) => {
      if (s.kind === "model-provider") return { kind: s.kind, id: s.id };
      if (s.kind === "channel") return { kind: s.kind, type: s.type };
      if (s.kind === "tool") return { kind: s.kind, name: s.name };
      return { kind: s.kind };
    });
    out.push({
      slug: reg.record.slug,
      name: reg.plugin.manifest.name,
      description: reg.plugin.manifest.description,
      version: reg.plugin.manifest.version,
      source: reg.record.source,
      enabled: reg.record.enabled,
      icon: reg.plugin.manifest.icon,
      homepage: reg.plugin.manifest.homepage,
      author: reg.plugin.manifest.author,
      services,
    });
  }
  return out.toSorted((a, b) => a.slug.localeCompare(b.slug));
}

export const list =
  (rt: Runtime): Handler =>
  () => {
    return json({ plugins: summarize(rt) });
  };

export const get =
  (rt: Runtime): Handler =>
  (_req, ctx) => {
    const slug = ctx.params.slug;
    const reg = rt.plugins.get(slug ?? "");
    if (!reg) return notFound(`plugin '${slug}' not found`);
    const services = reg.plugin.services.map((s) => {
      if (s.kind === "model-provider") {
        return {
          kind: s.kind,
          id: s.id,
          displayName: s.displayName,
          authHint: s.authHint,
          capabilities: s.capabilities,
          models: s.listModels(),
        };
      }
      if (s.kind === "channel") return { kind: s.kind, type: s.type, displayName: s.displayName };
      if (s.kind === "tool") return { kind: s.kind, name: s.name };
      if (s.kind === "mcp-bundle") {
        return {
          kind: s.kind,
          count: s.servers.length,
          servers: s.servers.map((srv) => ({
            name: srv.name,
            description: srv.description,
            descriptor: srv.descriptor,
          })),
        };
      }
      if (s.kind === "skill-pack") return { kind: s.kind, count: s.skills.length };
      // environment service.
      return {
        kind: s.kind,
        id: s.id,
        displayName: s.displayName,
        trustTier: s.trustTier,
        capabilities: s.capabilities,
      };
    });
    return json({
      slug: reg.record.slug,
      manifest: reg.plugin.manifest,
      record: reg.record,
      services,
    });
  };

export const setEnabled =
  (rt: Runtime): Handler =>
  async (req, ctx) => {
    const slug = ctx.params.slug ?? "";
    const reg = rt.plugins.get(slug);
    if (!reg) return notFound(`plugin '${slug}' not found`);
    const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
    const enabled = body.enabled !== false;
    rt.plugins.setEnabled(slug, enabled);
    await rt.state.setPluginEnabled(slug, enabled);
    return json({ slug, enabled });
  };
