// @oddjob/plugin-env-local-strict — three sandboxed local environments
// (seatbelt on macOS, bwrap on Linux, AppContainer/WSL2 on Windows).
//
// Each registers as its own EnvironmentService so the cascade resolver
// (or `oddjob env set-default <id>`) can pick a specific one. The setup
// wizard chooses the OS-appropriate default.

import type { EnvironmentProvider } from "@oddjob/core";
import { definePlugin } from "@oddjob/sdk";

import { AppContainerEnvironmentProvider } from "./appcontainer.ts";
import { isOnPath } from "./available.ts";
import { BwrapEnvironmentProvider } from "./bwrap.ts";
import { SeatbeltEnvironmentProvider } from "./seatbelt.ts";

export { SeatbeltEnvironmentProvider } from "./seatbelt.ts";
export { BwrapEnvironmentProvider } from "./bwrap.ts";
export { AppContainerEnvironmentProvider } from "./appcontainer.ts";
export { buildSeatbeltProfile } from "./seatbelt.ts";
export { buildBwrapArgs } from "./bwrap.ts";

const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
const isWindows = process.platform === "win32";

export default definePlugin(
  {
    slug: "env-local-strict",
    name: "Local strict environments",
    description:
      "Sandboxed local environments: seatbelt (macOS), bubblewrap (Linux), AppContainer/WSL2 (Windows).",
    version: "0.1.0",
    author: "Oddjob",
  },
  (b) => {
    b.environment({
      id: "seatbelt",
      displayName: "Seatbelt (macOS)",
      trustTier: "local-strict",
      capabilities: {
        snapshot: false,
        fork: false,
        pauseResume: false,
        exposePort: false,
        egressAllowlist: false,
        packageManagers: [],
      },
      available: async () => {
        if (!isMac) return { ok: false, reason: "seatbelt is macOS-only" };
        const have = await isOnPath("sandbox-exec");
        return have
          ? { ok: true }
          : { ok: false, reason: "sandbox-exec not on PATH (expected /usr/bin/sandbox-exec)" };
      },
      create: (): EnvironmentProvider => new SeatbeltEnvironmentProvider(),
    });

    b.environment({
      id: "bwrap",
      displayName: "Bubblewrap (Linux)",
      trustTier: "local-strict",
      capabilities: {
        snapshot: false,
        fork: false,
        pauseResume: false,
        exposePort: false,
        egressAllowlist: false,
        packageManagers: [],
      },
      available: async () => {
        if (!isLinux) return { ok: false, reason: "bwrap is Linux-only" };
        const have = await isOnPath("bwrap");
        return have
          ? { ok: true }
          : { ok: false, reason: "bwrap not on PATH (install bubblewrap package)" };
      },
      create: (): EnvironmentProvider => new BwrapEnvironmentProvider(),
    });

    b.environment({
      id: "appcontainer",
      displayName: "AppContainer (Windows)",
      trustTier: "local-strict",
      capabilities: {
        snapshot: false,
        fork: false,
        pauseResume: false,
        exposePort: false,
        egressAllowlist: false,
        packageManagers: [],
      },
      available: async () => {
        if (!isWindows) return { ok: false, reason: "appcontainer is Windows-only" };
        return {
          ok: false,
          reason: "AppContainer not implemented yet (v1.1); use env-process with warning",
        };
      },
      create: (): EnvironmentProvider => new AppContainerEnvironmentProvider(),
    });
  },
);
