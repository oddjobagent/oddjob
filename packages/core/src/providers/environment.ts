import type { Provider } from "./base.ts";
import type { EnvironmentConfig } from "../types/environment.ts";
import type { LogEntry } from "./logging.ts";

/**
 * EnvironmentProvider — runtime backend that produces an EnvironmentSession
 * for a single Run. Implementations: process (trusted host shell), seatbelt /
 * bwrap / appcontainer (local-strict), docker (container), daytona (remote VM).
 *
 * Capability methods on the session are feature-detected by callers via
 * `'X' in session` so providers degrade gracefully.
 */
export interface EnvironmentProvider extends Provider {
  spawn(config: EnvironmentRunConfig): Promise<EnvironmentSession>;
  /**
   * Optional: address the egress proxy must bind on so this provider's
   * sessions can reach it. Trusted / local-strict tiers omit this and the
   * runtime defaults to `127.0.0.1`. env-docker on Linux returns the docker
   * bridge gateway IP (e.g. `172.17.0.1`) because the container's loopback
   * is itself; on Mac/Windows Docker Desktop a return of `127.0.0.1` is
   * still correct because Docker Desktop forwards loopback traffic from
   * `host.docker.internal` to the host's loopback automatically.
   *
   * Returning `undefined` (or omitting the method entirely) keeps the
   * default `127.0.0.1` bind.
   */
  proxyBindAddress?(): Promise<string | undefined>;
}

/**
 * Per-spawn config. Carries the resolved Environment record (packages /
 * networking / image / workingDir) plus per-spawn ergonomics (workdir
 * override, env, timeout, abort signal, optional credential-broker proxy).
 *
 * The proxy is injected by the runtime when `config.networking.type ===
 * "limited"`. Providers that support it inject `HTTPS_PROXY` and trust the
 * `caPem` cert inside the session.
 */
export interface EnvironmentRunConfig {
  /** Resolved Environment record. Optional during 15a transition; required from 15b. */
  config?: EnvironmentConfig;
  /**
   * Host-side working directory the provider may bind-mount or upload from.
   * For trusted tiers (env-process, env-local-strict) this is also the
   * sessionWorkdir. For env-docker it becomes the bind source. For env-daytona
   * it is the host source for fs.uploadFile. Defaults to `config.workingDir`.
   */
  hostWorkdir?: string;
  /**
   * Working directory INSIDE the spawned session. Tools always reference this
   * for `cwd` in exec/writeFile/readFile. For trusted tiers it equals
   * hostWorkdir. For env-docker it is `/work`. For env-daytona it is
   * `config.workingDir ?? "/home/daytona/work"`.
   */
  sessionWorkdir?: string;
  /**
   * @deprecated Use `hostWorkdir` + `sessionWorkdir`. Retained as an alias for
   * pre-15i callers that only know about a single path. When set, providers
   * treat it as both host and session workdir.
   */
  workdir?: string;
  /** Pre-filtered env vars (secrets already removed by the runtime). */
  env?: Record<string, string>;
  networkAccess?: boolean;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  /** Aborts the entire session lifecycle. */
  signal?: AbortSignal;
  /** Credential-broker proxy. Provider injects HTTPS_PROXY + CA cert. */
  egressProxy?: { url: string; caPem: string };
  /**
   * Optional log sink the provider can use to surface session-lifecycle
   * notices (e.g. "egress proxy unreachable from this tier — falling back to
   * vendor network policy"). Wired by the agent loop to the run's
   * LogProvider so messages land alongside agent + tool logs.
   */
  onLog?: (entry: LogEntry) => void;
}

export interface EnvironmentSession {
  /**
   * Path INSIDE the session that callers (tools, the agent loop) should use
   * as the default `cwd` for exec and as the root for relative file paths.
   * For trusted tiers this is the host path. For env-docker this is `/work`.
   * For env-daytona this is the in-VM path.
   */
  readonly sessionWorkdir: string;
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  readFile(path: string): Promise<string>;
  kill(): Promise<void>;
  /** Optional capability: live-state snapshot. Daytona-style providers; locals omit. */
  snapshot?(name?: string): Promise<{ id: string }>;
  /** Optional capability: clone the session to a new instance. */
  fork?(): Promise<EnvironmentSession>;
  /** Optional capability: pause without killing. */
  pause?(): Promise<void>;
  /** Optional capability: resume after pause. */
  resume?(): Promise<void>;
  /** Optional capability: expose a port from the session for preview URLs. */
  exposePort?(port: number, opts?: { public?: boolean }): Promise<{ url: string; token?: string }>;
}

export interface ExecOptions {
  stdin?: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}
