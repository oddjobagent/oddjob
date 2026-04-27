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
      envVars.HTTPS_PROXY = config.egressProxy.url;
      envVars.HTTP_PROXY = config.egressProxy.url;
      envVars.https_proxy = config.egressProxy.url;
      envVars.http_proxy = config.egressProxy.url;
      envVars.NO_PROXY = "";
      envVars.no_proxy = "";
      envVars.NODE_USE_ENV_PROXY = "1";
      // The caPem string would need to be uploaded as a file inside the
      // sandbox after spawn so the proxy CA can be pinned. Deferred to 15h
      // SECURITY.md as a TODO since the v1 proxy emits caPem="" today.
    }
    const sandbox = await this.client.create(
      {
        image,
        envVars,
        ...(networkBlockAll ? { networkBlockAll } : {}),
      },
      { timeout: 90 },
    );
    return new DaytonaEnvironmentSession(this.client, sandbox);
  }
}

export class DaytonaEnvironmentSession implements EnvironmentSession {
  private destroyed = false;

  constructor(
    private readonly client: Daytona,
    private readonly sandbox: Sandbox,
  ) {}

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
        options.cwd,
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
    return new DaytonaEnvironmentSession(this.client, forked);
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
