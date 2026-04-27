import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { loadLocalPlugins, PluginRegistry, registerBundled } from "./index.ts";
import { definePlugin } from "../../../sdk/src/index.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-plugin-loader-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("plugin loader", () => {
  test("loads a local plugin from a tempdir", async () => {
    const pluginDir = join(dir, "test-plugin");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "oddjob-plugin.toml"),
      `slug = "test-plugin"\nname = "Test"\ndescription = "x"\nversion = "0.0.1"\nentry = "index.ts"\n[oddjob]\nengine = "*"\n`,
    );
    await writeFile(
      join(pluginDir, "index.ts"),
      `import { definePlugin } from "${join(import.meta.dir, "../../../sdk/src/index.ts")}";
export default definePlugin(
  { slug: "test-plugin", version: "0.0.1", description: "x" },
  (b) => b.modelProvider({
    id: "test-plugin",
    displayName: "Test Plugin",
    capabilities: { tools: false, streaming: false, vision: false, reasoning: false },
    listModels: () => [],
    createClient: () => ({ model: { id: "x" } as any }),
  }),
);`,
    );
    const registry = new PluginRegistry();
    const results = await loadLocalPlugins(registry, { root: dir });
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.slug).toBe("test-plugin");
    expect(registry.providerFor("test-plugin")).toBeDefined();
  });

  test("rejects a plugin whose default export isn't a Plugin", async () => {
    const pluginDir = join(dir, "broken");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "oddjob-plugin.toml"),
      `slug = "broken"\nversion = "0.0.1"\nentry = "index.ts"\n`,
    );
    await writeFile(join(pluginDir, "index.ts"), `export default 42;\n`);
    const registry = new PluginRegistry();
    const results = await loadLocalPlugins(registry, { root: dir });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toContain("not a Plugin");
  });

  test("rejects a plugin missing the manifest", async () => {
    const pluginDir = join(dir, "no-manifest");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "index.ts"), `export default {};\n`);
    const registry = new PluginRegistry();
    const results = await loadLocalPlugins(registry, { root: dir });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toContain("oddjob-plugin.toml");
  });

  test("registers a bundled plugin", () => {
    const registry = new PluginRegistry();
    const plugin = definePlugin({ slug: "bundled-x", version: "0.0.1", description: "x" }, (b) =>
      b.modelProvider({
        id: "bundled-x",
        displayName: "Bundled X",
        capabilities: { tools: true, streaming: true, vision: false, reasoning: false },
        listModels: () => [],
        createClient: () => {
          throw new Error("not used");
        },
      }),
    );
    const reg = registerBundled(registry, plugin);
    expect(reg.record.source).toBe("bundled");
    expect(registry.list()).toHaveLength(1);
    expect(registry.providerFor("bundled-x")).toBeDefined();
  });
});
