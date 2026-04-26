import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { defineCommand } from "citty";

import { loadBlueprint } from "@oddjob/core";

import { api } from "../lib/api.ts";

export default defineCommand({
  meta: { name: "push", description: "Push a blueprint directory to the server." },
  args: {
    path: { type: "positional", required: false, default: ".", description: "Blueprint dir" },
  },
  async run({ args }) {
    const bp = await loadBlueprint(args.path, { validate: true, checkFs: true });
    const tomlPath = bp.path;
    const abs = isAbsolute(tomlPath) ? tomlPath : resolve(args.path, "blueprint.toml");
    const toml = await readFile(abs, "utf8");
    const r = await api.blueprints.push(toml, abs);
    process.stdout.write(`pushed ${r.id} v${r.version}\n`);
    process.stdout.write(`hash: ${r.contentHash.slice(0, 12)}\n`);
  },
});
