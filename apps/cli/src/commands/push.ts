import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { defineCommand } from "citty";

import { loadBlueprint } from "@oddjob/core";

import { api } from "../lib/api.ts";

export default defineCommand({
  meta: { name: "push", description: "Push a blueprint directory to the server." },
  args: {
    path: { type: "positional", required: false, default: ".", description: "Blueprint dir" },
    tag: {
      type: "string",
      description: "Additional tag(s) to promote (comma-separated). 'latest' is always moved.",
    },
    force: {
      type: "boolean",
      default: false,
      description: "Overwrite an existing (id, version) row instead of failing with 409.",
    },
  },
  async run({ args }) {
    const bp = await loadBlueprint(args.path, { validate: true, checkFs: true });
    const tomlPath = bp.path;
    const abs = isAbsolute(tomlPath) ? tomlPath : resolve(args.path, "blueprint.toml");
    const toml = await readFile(abs, "utf8");
    const promoteTags =
      typeof args.tag === "string" && args.tag.length > 0
        ? args.tag
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
    const r = await api.blueprints.push({
      blueprint: { ...bp, sourceToml: toml, path: abs },
      promoteTags,
      force: args.force === true,
    });
    process.stdout.write(`pushed ${r.id} v${r.version}\n`);
    process.stdout.write(`hash: ${r.contentHash.slice(0, 12)}\n`);
    process.stdout.write(
      `tags: latest${promoteTags.length ? `, ${promoteTags.join(", ")}` : ""}\n`,
    );
  },
});
