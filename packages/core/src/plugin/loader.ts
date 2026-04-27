// Local-folder plugin loader. Discovers `~/.oddjob/plugins/<slug>/` directories,
// reads `oddjob-plugin.toml`, dynamic-imports the entry file, validates the
// default export shape, and registers the plugin in the supplied registry.
//
// The bundled plugin path uses `registerBundled()` directly — bundled plugins
// are imported statically so they survive `bun --compile`.

import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseToml } from "smol-toml";

import type { Plugin, PluginRecord, PluginSource } from "./types.ts";
import { PluginRegistry, type RegisteredPlugin } from "./registry.ts";

export interface ManifestFile {
  slug: string;
  name?: string;
  description?: string;
  version: string;
  author?: string;
  homepage?: string;
  icon?: string;
  /** Defaults to "index.ts". */
  entry?: string;
  oddjob?: { engine?: string };
}

export interface LoadLocalOptions {
  /** Root directory (typically `~/.oddjob/plugins`). */
  root: string;
  /** Optional logger for non-fatal load failures. */
  onError?: (slug: string, err: Error) => void;
  /** Slugs to skip entirely (no import, no register). */
  disabled?: ReadonlySet<string>;
}

export interface BundledRegistration {
  plugin: Plugin;
}

export function registerBundled(registry: PluginRegistry, plugin: Plugin): RegisteredPlugin {
  return registry.register(plugin, "bundled");
}

/** Discover and register every plugin under `root`. Returns load results. */
export async function loadLocalPlugins(
  registry: PluginRegistry,
  opts: LoadLocalOptions,
): Promise<Array<{ slug: string; ok: boolean; error?: string; record?: PluginRecord }>> {
  if (!existsSync(opts.root)) return [];
  const entries = await readdir(opts.root);
  const results: Array<{ slug: string; ok: boolean; error?: string; record?: PluginRecord }> = [];
  for (const name of entries) {
    if (name.startsWith(".") || name.startsWith("_")) continue;
    // Path containment: directory entries from readdir are basename-only, but
    // be defensive in case of symlinks/junk and refuse anything resolving outside.
    if (name.includes("/") || name === ".." || name === ".") continue;
    if (opts.disabled?.has(name)) continue;
    const dir = join(opts.root, name);
    let isDir = false;
    try {
      isDir = (await stat(dir)).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    try {
      const reg = await loadOne(registry, dir, "local");
      results.push({ slug: reg.record.slug, ok: true, record: reg.record });
    } catch (err) {
      const message = (err as Error).message;
      results.push({ slug: name, ok: false, error: message });
      opts.onError?.(name, err as Error);
    }
  }
  return results;
}

/** Low-level: load one plugin from a specific directory. */
export async function loadOne(
  registry: PluginRegistry,
  dir: string,
  source: PluginSource,
): Promise<RegisteredPlugin> {
  const manifest = await readManifest(dir);
  const entry = manifest.entry ?? "index.ts";
  const entryPath = join(dir, entry);
  if (!existsSync(entryPath)) {
    throw new Error(`plugin '${manifest.slug}' missing entry file: ${entry}`);
  }
  const mod = (await import(entryPath)) as { default?: Plugin } | undefined;
  const plugin = mod?.default;
  if (!plugin || typeof plugin !== "object" || !plugin.manifest) {
    throw new Error(
      `plugin '${manifest.slug}' default export is not a Plugin object (manifest missing)`,
    );
  }
  if (plugin.manifest.slug !== manifest.slug) {
    throw new Error(
      `plugin manifest slug '${plugin.manifest.slug}' does not match folder manifest '${manifest.slug}'`,
    );
  }
  const reg = registry.register(plugin, source);
  if (plugin.onLoad) await plugin.onLoad({ source, dir });
  return reg;
}

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

async function readManifest(dir: string): Promise<ManifestFile> {
  const path = join(dir, "oddjob-plugin.toml");
  if (!existsSync(path)) {
    throw new Error(`missing oddjob-plugin.toml in ${dir}`);
  }
  const src = await readFile(path, "utf8");
  const parsed = parseToml(src) as Record<string, unknown>;
  const slug = String(parsed.slug ?? "");
  const version = String(parsed.version ?? "");
  if (!slug) throw new Error(`plugin manifest missing 'slug' (${path})`);
  if (!version) throw new Error(`plugin manifest missing 'version' (${path})`);
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`plugin slug '${slug}' must be lowercase letters, digits, hyphens (${path})`);
  }
  const entry = parsed.entry as string | undefined;
  if (entry !== undefined) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new Error(`plugin entry must be a non-empty string (${path})`);
    }
    if (entry.startsWith("/") || entry.includes("..")) {
      throw new Error(`plugin entry must be a path inside the plugin directory (${path})`);
    }
  }
  return {
    slug,
    name: parsed.name as string | undefined,
    description: parsed.description as string | undefined,
    version,
    author: parsed.author as string | undefined,
    homepage: parsed.homepage as string | undefined,
    icon: parsed.icon as string | undefined,
    entry,
    oddjob: parsed.oddjob as { engine?: string } | undefined,
  };
}
