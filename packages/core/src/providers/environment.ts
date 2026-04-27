import type { Provider } from "./base.ts";
import type { EnvironmentConfig } from "../types/environment.ts";

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
  /** Per-spawn working dir override. Defaults to `config.workingDir`. */
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
}

export interface EnvironmentSession {
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
