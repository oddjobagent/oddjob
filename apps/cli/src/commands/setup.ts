import { defineCommand } from "citty";

import { loadOrCreateMasterKey } from "@oddjob/secrets-sqlite";

import { CONFIG_PATH, DEFAULT_CONFIG, ODDJOB_HOME, loadConfig, saveConfig } from "../lib/config.ts";
import { buildRuntime, shutdownRuntime } from "../lib/runtime.ts";

/**
 * Pick the OS-appropriate default environment service id. When 15d ships,
 * this picks `seatbelt` on macOS / `bwrap` on Linux. For now we have only the
 * trusted-local `process` service; print a loud warning.
 */
function pickDefaultServiceId(): { id: string; warning?: string } {
  const platform = process.platform;
  // 15d will register seatbelt (mac) / bwrap (linux). Until then the only
  // bundled environment is `process`, which gives the agent full host access.
  if (platform === "darwin") {
    return {
      id: "process",
      warning:
        "WARNING: env-process gives agents full host access. Switch to local-strict (seatbelt) when @oddjob/plugin-env-local-strict ships in 15d.",
    };
  }
  if (platform === "linux") {
    return {
      id: "process",
      warning:
        "WARNING: env-process gives agents full host access. Switch to local-strict (bwrap) when @oddjob/plugin-env-local-strict ships in 15d.",
    };
  }
  return {
    id: "process",
    warning:
      "WARNING: env-process gives agents full host access. Native AppContainer ships in v1.1; until then prefer WSL2 + bwrap.",
  };
}

export default defineCommand({
  meta: { name: "setup", description: "First-time setup: dirs, master key, config, environments." },
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

    // Setup gate: build the runtime + verify ≥1 environment service is
    // registered, then ensure ≥1 environment record exists. Auto-create a
    // `default` row pointing at the platform-appropriate service.
    const rt = await buildRuntime(cfg);
    try {
      const services = rt.plugins.listEnvironments();
      if (services.length === 0) {
        process.stderr.write(
          "ERROR: no environment service is registered. Install at least one @oddjob/plugin-env-* plugin.\n",
        );
        process.exitCode = 2;
        return;
      }
      const summary = services
        .map((s) => `  - ${s.id} (${s.trustTier}) — ${s.displayName}`)
        .join("\n");
      process.stdout.write(`environment services registered:\n${summary}\n`);

      // Idempotently ensure the hard-default `default` Environment row exists.
      // The cascade resolver always names "default" as its hardDefaultId so
      // even when an engine default is set, the row must remain present as a
      // last-resort fallback (e.g. operator deletes the engine_setting row).
      const existing = await rt.state.getEnvironment("default");
      const pick = pickDefaultServiceId();
      const serviceId = rt.plugins.environmentFor(pick.id) ? pick.id : services[0]!.id;
      if (!existing) {
        await rt.state.upsertEnvironment({
          id: "default",
          name: "Default",
          description: `Auto-created at setup. Backed by '${serviceId}'.`,
          config: { type: "local", provider: { service: serviceId } },
        });
        process.stdout.write(`created default environment: id="default" service="${serviceId}"\n`);
        if (pick.warning) process.stderr.write(`${pick.warning}\n`);
      } else {
        process.stdout.write(
          `default environment already exists: service=${existing.config.provider?.service ?? "(unset)"}\n`,
        );
      }
      // Ensure engine default points at SOMETHING. Prefer the existing
      // engine_setting; otherwise fall back to "default".
      const engineDefault = await rt.state.getEngineSetting<string>("default_environment_id");
      if (!engineDefault) {
        await rt.state.setEngineSetting("default_environment_id", "default");
        process.stdout.write(`engine default set to: default\n`);
      }
      const envs = await rt.state.listEnvironments();
      if (envs.length > 1) {
        const ids = envs.map((e) => e.id).join(", ");
        process.stdout.write(`environments configured: ${ids}\n`);
      }
    } finally {
      await shutdownRuntime(rt);
    }

    process.stdout.write("done.\n");
  },
});
