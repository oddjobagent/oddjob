import type { EnvironmentProvider, EnvironmentRunConfig, EnvironmentSession } from "@oddjob/core";

/**
 * Windows AppContainer wrapper. v1 punts to WSL2 (planned: `wsl bwrap ...`)
 * and native AppContainer is v1.1 per the master plan. Until then, the
 * service is registered so the dashboard can show "appcontainer (Windows)
 * — unavailable", but `spawn()` MUST refuse to run rather than fall back
 * to an unwrapped sh — that would silently downgrade the trust tier.
 */
export class AppContainerEnvironmentProvider implements EnvironmentProvider {
  readonly name = "env-appcontainer";

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return false;
  }

  async spawn(_config: EnvironmentRunConfig): Promise<EnvironmentSession> {
    throw new Error(
      "env-appcontainer: not yet implemented (v1.1). Use 'process' (with warning) or run on Linux/macOS with the local-strict default.",
    );
  }
}
