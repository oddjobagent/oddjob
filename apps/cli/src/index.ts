#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";

const main = defineCommand({
  meta: {
    name: "oddjob",
    version: "0.0.0",
    description: "Task-specific AI agent runtime",
  },
  subCommands: {
    setup: () => import("./commands/setup.ts").then((m) => m.default),
    serve: () => import("./commands/serve.ts").then((m) => m.default),
    init: () => import("./commands/init.ts").then((m) => m.default),
    validate: () => import("./commands/validate.ts").then((m) => m.default),
    run: () => import("./commands/run.ts").then((m) => m.default),
    push: () => import("./commands/push.ts").then((m) => m.default),
    pull: () => import("./commands/pull.ts").then((m) => m.default),
    deploy: () => import("./commands/deploy.ts").then((m) => m.default),
    undeploy: () => import("./commands/undeploy.ts").then((m) => m.default),
    secrets: () => import("./commands/secrets.ts").then((m) => m.default),
    skills: () => import("./commands/skills.ts").then((m) => m.default),
    mcp: () => import("./commands/mcp.ts").then((m) => m.default),
    channel: () => import("./commands/channel.ts").then((m) => m.default),
    auth: () => import("./commands/auth.ts").then((m) => m.default),
    status: () => import("./commands/status.ts").then((m) => m.default),
    list: () => import("./commands/list.ts").then((m) => m.default),
    logs: () => import("./commands/logs.ts").then((m) => m.default),
    output: () => import("./commands/output.ts").then((m) => m.default),
    inspect: () => import("./commands/inspect.ts").then((m) => m.default),
  },
});

void runMain(main);
