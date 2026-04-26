import { defineCommand } from "citty";

import { startServer } from "@oddjob/server";

import { loadConfig } from "../lib/config.ts";
import { buildRuntime, shutdownRuntime } from "../lib/runtime.ts";

export default defineCommand({
  meta: { name: "serve", description: "Start the Oddjob server." },
  args: {
    host: { type: "string", description: "Bind host", default: "" },
    port: { type: "string", description: "Bind port", default: "" },
    workers: { type: "string", description: "Max concurrent runs", default: "" },
  },
  async run({ args }) {
    const cfg = await loadConfig();
    if (args.host) cfg.server.host = args.host;
    if (args.port) cfg.server.port = Number(args.port);
    if (args.workers) cfg.server.max_workers = Number(args.workers);

    const rt = await buildRuntime(cfg);
    const server = await startServer({ runtime: rt });
    process.stdout.write(`oddjob serving on ${server.url}\n`);

    const shutdown = async () => {
      process.stdout.write("\nshutting down...\n");
      await server.stop();
      await shutdownRuntime(rt);
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());

    await new Promise(() => {
      /* keep alive */
    });
  },
});
