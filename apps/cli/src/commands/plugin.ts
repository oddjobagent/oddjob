import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { defineCommand } from "citty";

import { api } from "../lib/api.ts";

const PLUGINS_HOME = join(process.env.ODDJOB_HOME ?? join(homedir(), ".oddjob"), "plugins");

export default defineCommand({
  meta: { name: "plugin", description: "Manage Oddjob plugins (list / install / reload)." },
  args: {
    action: {
      type: "positional",
      required: true,
      description: "list | install | reload | enable | disable",
    },
    target: { type: "positional", required: false, description: "Plugin slug or path" },
  },
  async run({ args }) {
    switch (args.action) {
      case "list": {
        const r = await api.plugins.list();
        for (const p of r.plugins) {
          const services = p.services
            .map((s) =>
              s.kind === "model-provider"
                ? `provider:${s.id ?? "?"}`
                : s.kind === "channel"
                  ? `channel:${s.type ?? "?"}`
                  : s.kind === "tool"
                    ? `tool:${s.name ?? "?"}`
                    : s.kind,
            )
            .join(", ");
          const flag = p.enabled ? "y" : "-";
          process.stdout.write(
            `${flag} ${p.slug.padEnd(20)} ${p.version.padEnd(10)} ${p.source.padEnd(8)} ${services}\n`,
          );
        }
        break;
      }
      case "install": {
        if (!args.target) throw new Error("usage: oddjob plugin install <directory>");
        const src = resolve(String(args.target));
        const manifestPath = join(src, "oddjob-plugin.toml");
        try {
          await stat(manifestPath);
        } catch {
          throw new Error(`source missing oddjob-plugin.toml: ${src}`);
        }
        const slug = await parseManifestSlug(manifestPath);
        const dest = join(PLUGINS_HOME, slug);
        await mkdir(dest, { recursive: true });
        await copyTree(src, dest);
        process.stdout.write(`installed '${slug}' to ${dest}\n`);
        process.stdout.write(`restart the server (taskmux restart server) to load it\n`);
        break;
      }
      case "reload": {
        process.stdout.write(`local plugins live-reload requires a server restart in v1\n`);
        process.stdout.write(`run: taskmux restart server\n`);
        break;
      }
      case "enable":
      case "disable": {
        if (!args.target) throw new Error(`usage: oddjob plugin ${args.action} <slug>`);
        const r = await api.plugins.setEnabled(String(args.target), args.action === "enable");
        process.stdout.write(`${r.slug}: ${r.enabled ? "enabled" : "disabled"}\n`);
        break;
      }
      default:
        process.stderr.write(`unknown action: ${args.action}\n`);
        process.exitCode = 1;
        return;
    }
  },
});

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

async function parseManifestSlug(path: string): Promise<string> {
  const text = await readFile(path, "utf8");
  const match = /^slug\s*=\s*"([^"]+)"/m.exec(text);
  if (!match) throw new Error(`could not find slug in ${path}`);
  const slug = match[1]!;
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `plugin slug '${slug}' must be lowercase letters, digits, hyphens (no path components)`,
    );
  }
  return slug;
}

async function copyTree(src: string, dest: string): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
    const s = join(src, e.name);
    const d = join(dest, e.name);
    if (e.isDirectory()) {
      await mkdir(d, { recursive: true });
      await copyTree(s, d);
    } else if (e.isFile()) {
      await mkdir(dirname(d), { recursive: true });
      await copyFile(s, d);
    }
  }
}
