import { Daytona, type Sandbox } from "@daytonaio/sdk";

import type {
  EnvironmentProvider,
  EnvironmentRunConfig,
  EnvironmentSession,
  ExecOptions,
  ExecResult,
} from "@oddjob/core";

interface DaytonaProviderOptions {
  apiKey: string;
  /** Optional override for the Daytona API base URL (self-hosted control planes). */
  baseUrl?: string;
}

export class DaytonaEnvironmentProvider implements EnvironmentProvider {
  readonly name = "env-daytona";
  private readonly client: Daytona;

  constructor(opts: DaytonaProviderOptions) {
    this.client = new Daytona({
      apiKey: opts.apiKey,
      ...(opts.baseUrl ? { apiUrl: opts.baseUrl } : {}),
    });
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return true;
  }

  async spawn(config: EnvironmentRunConfig): Promise<EnvironmentSession> {
    const image = config.config?.image ?? "ubuntu:24.04";
    const networkBlockAll = config.config?.networking?.type === "limited";
    const envVars: Record<string, string> = { ...config.env };
    if (config.egressProxy) {
      // 15i-2: remote-vm tier cannot reach the operator's host loopback, so
      // injecting HTTPS_PROXY=http://127.0.0.1:N would silently fail (the VM
      // resolves 127.0.0.1 to itself). For v1 we drop the proxy env entirely
      // and surface a warning so operators understand egress falls through to
      // Daytona's network policy (`networkBlockAll` is in effect when the env
      // declared `networking = "limited"` — vendor block-all replaces the
      // per-host allowlist gate the broker would normally enforce). v1.1 is
      // slated to ship an Oddjob-managed relay so the credential broker
      // covers all tiers consistently.
      //
      // The proxy URL embeds a per-Run Basic-auth token; surface only host +
      // port in the log meta so the secret never lands in run_logs (which
      // are user-readable via the dashboard log tail).
      const meta: Record<string, unknown> = {};
      try {
        const u = new URL(config.egressProxy.url);
        meta.proxyHost = u.hostname;
        meta.proxyPort = u.port;
      } catch {
        // Malformed URL — emit a constant marker rather than the raw string
        // so we never leak whatever the URL parser tripped on.
        meta.proxyHost = "<unparseable>";
      }
      config.onLog?.({
        timestamp: Date.now(),
        level: "warn",
        message:
          "egress proxy not applied: env-daytona (remote-vm tier) cannot reach operator localhost. Daytona networkBlockAll is in effect when `networking = \"limited\"`; the per-host allowlist gate the broker would otherwise enforce is therefore not active. v1.1 will introduce an Oddjob-managed relay.",
        meta,
      });
    }
    // Remote-VM tier: hostWorkdir is only used for upload-time references
    // (sandbox.fs.uploadFile); sessionWorkdir is the in-VM path that tools
    // receive as their default cwd.
    const sessionWorkdir =
      config.sessionWorkdir ??
      config.config?.workingDir ??
      config.workdir ??
      "/home/daytona/work";
    const sandbox = await this.client.create(
      {
        image,
        envVars,
        ...(networkBlockAll ? { networkBlockAll } : {}),
      },
      { timeout: 90 },
    );
    return new DaytonaEnvironmentSession(this.client, sandbox, sessionWorkdir);
  }
}

export class DaytonaEnvironmentSession implements EnvironmentSession {
  private destroyed = false;
  readonly sessionWorkdir: string;

  constructor(
    private readonly client: Daytona,
    private readonly sandbox: Sandbox,
    sessionWorkdir: string,
  ) {
    this.sessionWorkdir = sessionWorkdir;
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    if (this.destroyed) throw new Error("env-daytona: session destroyed");
    const start = Date.now();
    // Daytona's executeCommand returns combined output (no stdout/stderr split)
    // so we route stderr into stdout via shell redirection. Callers that need
    // separate streams should use a remote-vm-aware tool wrapper.
    const wrapped = `${command} 2>&1`;
    const timeoutSec = Math.max(1, Math.ceil((options.timeoutMs ?? 60_000) / 1000));
    try {
      const r = await this.sandbox.process.executeCommand(
        wrapped,
        options.cwd ?? this.sessionWorkdir,
        options.env,
        timeoutSec,
      );
      return {
        exitCode: typeof r.exitCode === "number" ? r.exitCode : -1,
        stdout: r.result ?? "",
        stderr: "",
        durationMs: Date.now() - start,
        truncated: false,
      };
    } catch (err) {
      // Surface DaytonaError (network/timeout) as a non-zero exit so the
      // agent loop sees a normal failure rather than an unhandled throw.
      return {
        exitCode: -1,
        stdout: "",
        stderr: (err as Error).message ?? String(err),
        durationMs: Date.now() - start,
        truncated: false,
      };
    }
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    if (this.destroyed) throw new Error("env-daytona: session destroyed");
    const buf = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    await this.sandbox.fs.uploadFile(buf, path);
  }

  async readFile(path: string): Promise<string> {
    if (this.destroyed) throw new Error("env-daytona: session destroyed");
    const out = await this.sandbox.fs.downloadFile(path);
    return out.toString("utf8");
  }

  async kill(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      await this.client.delete(this.sandbox);
    } catch {
      /* swallow — sandbox may already be gone */
    }
  }

  // Optional capabilities — feature-detected by callers via `'X' in session`.
  // Daytona's snapshot/fork are still _experimental_ in v0.169.0; we wrap
  // them under stable names but pass through any SDK errors verbatim.

  async snapshot(name?: string): Promise<{ id: string }> {
    if (this.destroyed) throw new Error("env-daytona: session destroyed");
    const snapName = name ?? `oddjob-${Date.now()}`;
    await this.sandbox._experimental_createSnapshot(snapName);
    return { id: snapName };
  }

  async fork(): Promise<EnvironmentSession> {
    if (this.destroyed) throw new Error("env-daytona: session destroyed");
    const forked = await this.sandbox._experimental_fork({});
    return new DaytonaEnvironmentSession(this.client, forked, this.sessionWorkdir);
  }

  async pause(): Promise<void> {
    if (this.destroyed) throw new Error("env-daytona: session destroyed");
    await this.sandbox.stop();
  }

  async resume(): Promise<void> {
    if (this.destroyed) throw new Error("env-daytona: session destroyed");
    await this.sandbox.start();
  }

  async exposePort(
    port: number,
    opts?: { public?: boolean },
  ): Promise<{ url: string; token?: string }> {
    if (this.destroyed) throw new Error("env-daytona: session destroyed");
    const signed = (await this.sandbox.getSignedPreviewUrl(port, 3600)) as {
      url?: string;
      previewUrl?: string;
      token?: string;
    };
    const url = signed.url ?? signed.previewUrl ?? "";
    void opts;
    return signed.token ? { url, token: signed.token } : { url };
  }
}
