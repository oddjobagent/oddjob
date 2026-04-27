import { defineCommand } from "citty";

import { loadOrCreateMasterKey } from "@oddjob/secrets-sqlite";

import { CONFIG_PATH, DEFAULT_CONFIG, ODDJOB_HOME, loadConfig, saveConfig } from "../lib/config.ts";
import { buildRuntime, shutdownRuntime } from "../lib/runtime.ts";

/**
 * Per-platform priority order for picking the default environment service.
 * Higher-trust services come first; the trusted-local `process` service is
 * the very last resort.
 */
function priorityOrderForPlatform(): string[] {
  const platform = process.platform;
  if (platform === "darwin") return ["seatbelt", "process"];
  if (platform === "linux") return ["bwrap", "process"];
  if (platform === "win32") return ["appcontainer", "process"];
  return ["process"];
}

interface AvailabilityProbe {
  (id: string): Promise<{ ok: boolean; reason?: string } | undefined>;
}

interface PickedDefault {
  /** Service id chosen. Always non-null when called with a non-empty registry. */
  id: string;
  /** Trust tier of the picked service, surfaced to the operator. */
  trustTier: string;
  /** Optional warning printed after creation (e.g. "fell back to process"). */
  warning?: string;
}

/**
 * Walk the platform's priority order, calling `available()` on each
 * registered service until we find one that says ok. Returns the first
 * available service plus a warning if we had to fall back below the
 * preferred tier.
 *
 * Refuses with `null` if nothing is available — caller should error.
 */
async function pickDefaultService(
  registered: ReadonlyArray<{ id: string; trustTier: string }>,
  available: AvailabilityProbe,
): Promise<PickedDefault | null> {
  const order = priorityOrderForPlatform();
  const reasons: string[] = [];
  for (const id of order) {
    const svc = registered.find((s) => s.id === id);
    if (!svc) continue;
    const status = await available(id);
    if (status?.ok) {
      const fellBack = order.indexOf(id) > 0;
      return {
        id,
        trustTier: svc.trustTier,
        warning: fellBack
          ? `WARNING: preferred ${order[0]} unavailable; fell back to ${id} (${svc.trustTier}).${reasons.length ? " Reasons: " + reasons.join("; ") : ""}`
          : undefined,
      };
    }
    reasons.push(`${id}=${status?.reason ?? "unknown"}`);
  }
  // Nothing in the priority order was available. Try ANY registered
  // service before giving up — the operator may have side-loaded a custom
  // strict env (e.g. firejail) that's not in the platform default list.
  for (const svc of registered) {
    const status = await available(svc.id);
    if (status?.ok) {
      return {
        id: svc.id,
        trustTier: svc.trustTier,
        warning: `WARNING: no platform-default env service available; using side-loaded ${svc.id} (${svc.trustTier}).`,
      };
    }
  }
  return null;
}

const STRICT_TIERS = new Set(["local-strict", "container", "remote-vm"]);

export default defineCommand({
  meta: { name: "setup", description: "First-time setup: dirs, master key, config, environments." },
  args: {
    force: { type: "boolean", description: "Re-run even if already set up", default: false },
    "migrate-default": {
      type: "boolean",
      description: "Migrate existing 'default' env to a stricter service if one is now available.",
      default: false,
    },
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

      const probe: AvailabilityProbe = async (id) => {
        const svc = rt.plugins.environmentFor(id);
        return svc ? await svc.available() : undefined;
      };
      const pick = await pickDefaultService(
        services.map((s) => ({ id: s.id, trustTier: s.trustTier })),
        probe,
      );
      if (!pick) {
        process.stderr.write(
          "ERROR: no environment service reports available=true. Install bubblewrap (Linux), enable Seatbelt (macOS), or accept the env-process trade-off.\n",
        );
        process.exitCode = 2;
        return;
      }

      const existing = await rt.state.getEnvironment("default");
      if (!existing) {
        await rt.state.upsertEnvironment({
          id: "default",
          name: "Default",
          description: `Auto-created at setup. Backed by '${pick.id}' (${pick.trustTier}).`,
          config: { type: "local", provider: { service: pick.id } },
        });
        process.stdout.write(
          `created default environment: id="default" service="${pick.id}" trust="${pick.trustTier}"\n`,
        );
        if (pick.warning) process.stderr.write(`${pick.warning}\n`);
      } else {
        const currentService = existing.config.provider?.service ?? "(unset)";
        process.stdout.write(`default environment already exists: service=${currentService}\n`);
        const currentSvc = services.find((s) => s.id === currentService);
        const currentlyStrict = currentSvc ? STRICT_TIERS.has(currentSvc.trustTier) : false;
        const pickedStrict = STRICT_TIERS.has(pick.trustTier);
        if (!currentlyStrict && pickedStrict && currentService !== pick.id) {
          if (args["migrate-default"]) {
            await rt.state.upsertEnvironment({
              ...existing,
              description: `Migrated to '${pick.id}' (${pick.trustTier}) at setup --migrate-default.`,
              config: {
                ...existing.config,
                provider: { ...existing.config.provider, service: pick.id },
              },
            });
            process.stdout.write(
              `migrated default environment: ${currentService} -> ${pick.id} (${pick.trustTier})\n`,
            );
          } else {
            process.stderr.write(
              `NOTE: stricter environment '${pick.id}' (${pick.trustTier}) is now available. Re-run \`oddjob setup --migrate-default\` to switch the default to it.\n`,
            );
          }
        }
      }

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
