// @oddjob/plugin-env-docker — bundled "docker" environment plugin.
//
// Trust tier: container. One Docker container per Run. Mounts the host
// per-session workdir as /work, --rm cleanup, default image
// `oddjob/runtime:latest` (build via `docker build -t oddjob/runtime:latest
// docker/oddjob-runtime` — see docker/oddjob-runtime/README.md).

import type { EnvironmentProvider } from "@oddjob/core";
import { definePlugin } from "@oddjob/sdk";

import { DockerEnvironmentProvider, dockerInfo } from "./provider.ts";

export { DockerEnvironmentProvider, DockerSession } from "./provider.ts";

export default definePlugin(
  {
    slug: "env-docker",
    name: "Docker environment",
    description:
      "Container environment backed by the local Docker daemon. One container per Run, mounted workdir, --rm cleanup.",
    version: "0.1.0",
    author: "Oddjob",
  },
  (b) =>
    b.environment({
      id: "docker",
      displayName: "Docker",
      trustTier: "container",
      capabilities: {
        snapshot: false,
        fork: false,
        pauseResume: true,
        exposePort: false,
        // Docker-level egress filtering is not configured here; the proxy
        // env-vars are injected so HTTP libs route through the broker.
        egressAllowlist: false,
        packageManagers: ["apt", "pip", "npm"],
      },
      available: dockerInfo,
      create: (): EnvironmentProvider => new DockerEnvironmentProvider(),
    }),
);
