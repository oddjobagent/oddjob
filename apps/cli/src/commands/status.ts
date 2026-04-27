import { defineCommand } from "citty";

import { api } from "../lib/api.ts";

export default defineCommand({
  meta: { name: "status", description: "Show server status." },
  async run() {
    const s = (await api.status()) as Record<string, unknown>;
    process.stdout.write(JSON.stringify(s, null, 2) + "\n");
  },
});
