import type { Provider } from "./base.ts";

export interface SandboxProvider extends Provider {
  spawn(config: SandboxConfig): Promise<SandboxSession>;
}

export interface SandboxConfig {
  workdir?: string;
  env?: Record<string, string>;
  networkAccess?: boolean;
  timeoutMs?: number;
  maxStdoutBytes?: number;
}

export interface SandboxSession {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  readFile(path: string): Promise<string>;
  kill(): Promise<void>;
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
