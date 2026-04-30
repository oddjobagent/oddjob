import { defineCommand } from "citty";

import { loadBlueprint } from "@oddjob/core";

export default defineCommand({
  meta: { name: "validate", description: "Validate a blueprint.toml." },
  args: {
    path: {
      type: "positional",
      required: false,
      default: ".",
      description: "Blueprint dir or file",
    },
  },
  async run({ args }) {
    // Plugin-tool names are enforced by the server on push, not the offline
    // validator — local plugins under ~/.oddjob/plugins are server-side state.
    const bp = await loadBlueprint(args.path, { validate: true, checkFs: true });
    process.stdout.write(`OK ${bp.id} v${bp.version} (hash ${bp.contentHash.slice(0, 8)})\n`);
    process.stdout.write(`  scripts: ${Object.keys(bp.scripts).length}\n`);
    process.stdout.write(`  connectors: ${Object.keys(bp.connectors).length}\n`);
    process.stdout.write(`  skills: ${bp.skills.length}\n`);
  },
});
