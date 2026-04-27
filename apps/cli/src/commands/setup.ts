import { defineCommand } from "citty";

import { loadOrCreateMasterKey } from "@oddjob/secrets-sqlite";

import { CONFIG_PATH, DEFAULT_CONFIG, ODDJOB_HOME, loadConfig, saveConfig } from "../lib/config.ts";

export default defineCommand({
  meta: { name: "setup", description: "First-time setup: dirs, master key, config." },
  args: {
    force: { type: "boolean", description: "Re-run even if already set up", default: false },
  },
  async run({ args }) {
    const cfg = await loadConfig().catch(() => DEFAULT_CONFIG);
    await saveConfig(cfg);
    process.stdout.write(`config: ${CONFIG_PATH}\n`);
    process.stdout.write(`oddjob home: ${ODDJOB_HOME}\n`);

    const key = await loadOrCreateMasterKey();
    process.stdout.write(
      `master key: ${args.force ? "rotated" : "loaded"} (${key.length * 8}-bit)\n`,
    );
    process.stdout.write("done.\n");
  },
});
