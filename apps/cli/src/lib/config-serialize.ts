// Atomic TOML rewrite. Reads current DB state for `source='config'` rows and
// emits matching `[providers.*.*]` and `[roles.*]` blocks. Existing
// `[server]`, `[builtin_tools]`, and `[plugins]` blocks are preserved by
// re-reading the current file, mutating, and re-stringifying.
//
// Comment-preservation is best-effort: smol-toml round-trips top-level keys
// but drops comments inside re-emitted tables. Document the trade-off in the
// file header (added on first dashboard write).

import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { stringify, parse as parseToml } from "smol-toml";

import type { StateProvider } from "@oddjob/core";

import { CONFIG_PATH, type OddjobConfig } from "./config.ts";

const HEADER = [
  "# Oddjob engine config — managed by the dashboard.",
  "# Sections [providers.*] and [roles.*] may be rewritten on save; comments inside them will be lost.",
  "# Edit freely when the server is stopped, or use `oddjob config reload` after manual edits.",
  "",
].join("\n");

export async function persistConfigFromDb(state: StateProvider): Promise<void> {
  const base: Record<string, unknown> = {};

  if (existsSync(CONFIG_PATH)) {
    const src = await readFile(CONFIG_PATH, "utf8");
    let parsed: Record<string, unknown>;
    try {
      parsed = parseToml(src) as Record<string, unknown>;
    } catch (err) {
      // Refuse to overwrite a file we can't parse — losing user content there
      // would be much worse than the dashboard write failing.
      throw new Error(
        `oddjob: refusing to rewrite ${CONFIG_PATH} — current contents are not valid TOML (${
          (err as Error).message
        }). Fix the file by hand, then retry.`,
        { cause: err },
      );
    }
    // Keep server, builtin_tools, plugins, and any user-added top-level
    // sections we don't manage. Strip the managed ones; we'll re-emit them.
    for (const [k, v] of Object.entries(parsed)) {
      if (k === "providers" || k === "roles") continue;
      base[k] = v;
    }
  }

  // Providers from DB (source='config' only).
  const allCreds = await state.listProviderCredentials();
  const providers: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const c of allCreds) {
    if (c.source !== "config") continue;
    const inner: Record<string, unknown> = {};
    if (c.apiKeySecret) inner.api_key_secret = c.apiKeySecret;
    if (c.optionsJson) {
      try {
        inner.options = JSON.parse(c.optionsJson) as Record<string, unknown>;
      } catch {
        // skip unparseable options
      }
    }
    providers[c.providerSlug] ??= {};
    providers[c.providerSlug]![c.credentialName] = inner;
  }
  if (Object.keys(providers).length > 0) base.providers = providers;

  // Roles from DB (source='config' only).
  const allRoles = await state.listEngineModelRoles();
  const roles: Record<string, Record<string, unknown>> = {};
  for (const r of allRoles) {
    if (r.source !== "config") continue;
    const body: Record<string, unknown> = {
      provider: r.providerSlug,
      model: r.modelId,
    };
    if (r.credentialName !== "default") body.credential = r.credentialName;
    if (r.optionsJson) {
      try {
        body.options = JSON.parse(r.optionsJson) as Record<string, unknown>;
      } catch {
        // skip unparseable options
      }
    }
    roles[r.role] = body;
  }
  if (Object.keys(roles).length > 0) base.roles = roles;

  const body = stringify(base);
  const out = `${HEADER}${body.endsWith("\n") ? body : `${body}\n`}`;
  await atomicWrite(CONFIG_PATH, out);
}

export async function readConfigForReload(): Promise<OddjobConfig | undefined> {
  // Just re-runs loadConfig but kept here as a clear name for callers.
  const { loadConfig } = await import("./config.ts");
  return loadConfig();
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  const dir = dirname(path);
  const tmp = join(dir, `.${path.split("/").at(-1)}.${process.pid}.tmp`);
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, path);
}
