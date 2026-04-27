import { defineCommand } from "citty";

import { startServer, type HtmlBundle } from "@oddjob/server";

import { loadConfig } from "../lib/config.ts";
import { buildRuntime, shutdownRuntime, warnIfBareProcessEnv } from "../lib/runtime.ts";

// Static import keeps the dashboard bundled into `bun build --compile` output.
// The future split removes this import + the --no-ui flag.
import dashboardHtml from "../../../dashboard/src/index.html";

export default defineCommand({
  meta: { name: "serve", description: "Start the Oddjob server." },
  args: {
    host: { type: "string", description: "Bind host", default: "" },
    port: { type: "string", description: "Bind port", default: "" },
    workers: { type: "string", description: "Max concurrent runs", default: "" },
    ui: {
      type: "boolean",
      description: "Mount the web dashboard (use --no-ui to run headless)",
      default: true,
    },
  },
  async run({ args }) {
    const cfg = await loadConfig();
    if (args.host) cfg.server.host = args.host;
    if (args.port) cfg.server.port = Number(args.port);
    if (args.workers) cfg.server.max_workers = Number(args.workers);

    const dashboard: HtmlBundle | undefined = args.ui ? (dashboardHtml as HtmlBundle) : undefined;

    const rt = await buildRuntime(cfg);
    await warnIfBareProcessEnv(rt);
    const server = await startServer({ runtime: rt, dashboard });
    process.stdout.write(`oddjob serving on ${server.url}\n`);
    if (dashboard) {
      process.stdout.write(`  dashboard:  ${server.url}/\n`);
    } else {
      process.stdout.write(`  headless:   no dashboard mounted (--no-ui)\n`);
    }
    process.stdout.write(`  api:        ${server.url}/api/v1/health\n`);

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
