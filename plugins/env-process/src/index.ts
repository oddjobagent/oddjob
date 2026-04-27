// @oddjob/plugin-env-process — bundled "process" environment plugin.
//
// Trust tier: trusted. The agent runs commands in the host shell from a
// per-session tempdir. NO sandboxing. Dev-only — production deployments
// should use env-local-strict or env-docker.

import type { EnvironmentProvider } from "@oddjob/core";
import { definePlugin } from "@oddjob/sdk";

import { ProcessEnvironmentProvider } from "./provider.ts";

export { ProcessEnvironmentProvider } from "./provider.ts";

export default definePlugin(
  {
    slug: "env-process",
    name: "Process environment",
    description: "Trusted-local: runs commands in the host shell (tempdir per session). Dev only.",
    version: "0.1.0",
    author: "Oddjob",
  },
  (b) =>
    b.environment({
      id: "process",
      displayName: "Process (host shell)",
      trustTier: "trusted",
      capabilities: {
        snapshot: false,
        fork: false,
        pauseResume: false,
        exposePort: false,
        egressAllowlist: false,
        packageManagers: [],
      },
      available: async () => ({ ok: true }),
      create: (): EnvironmentProvider => new ProcessEnvironmentProvider(),
    }),
);
