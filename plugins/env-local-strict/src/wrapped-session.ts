import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  EnvironmentRunConfig,
  EnvironmentSession,
  ExecOptions,
  ExecResult,
} from "@oddjob/core";

import { resolveInsideStrict, validateStrictWorkdir } from "./fs-policy.ts";

/**
 * Curated host-env allowlist for strict-local sandboxes. Same shape as
 * env-process: PATH/HOME/USER/SHELL/TMPDIR/LANG/LC_ALL only — never the
 * host's API keys, SSH agent, or AWS_* etc. The `env` arg from
 * EnvironmentRunConfig (placeholders rewritten by the credential broker)
 * is layered on top.
 */
const HOST_ENV_ALLOWLIST = ["PATH", "HOME", "USER", "SHELL", "TMPDIR", "LANG", "LC_ALL"] as const;

function buildBaseEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of HOST_ENV_ALLOWLIST) {
    const v = process.env[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export interface CommandWrapper {
  buildArgv(command: string, ctx: WrapperContext): string[];
  prepare?(ctx: WrapperContext): Promise<void>;
  teardown?(ctx: WrapperContext): Promise<void>;
}

export interface WrapperContext {
  /** Per-session workdir (writable subpath inside the sandbox). */
  root: string;
  /** Tempdir for sandbox-private files (profile script, CA cert, etc). */
  meta: string;
  config: EnvironmentRunConfig;
}

interface ActiveProc {
  kill: () => void;
  awaitExit: Promise<void>;
}

export class WrappedSession implements EnvironmentSession {
  private active = new Set<ActiveProc>();
  private destroyed = false;
  private prepared = false;
  private readonly sessionAbort: AbortSignal | undefined;
  private readonly sessionAbortHandlers = new Set<() => void>();
  /** Strict-local tier: session path equals host path (no namespace boundary). */
  readonly sessionWorkdir: string;

  constructor(
    private readonly ctx: WrapperContext,
    private readonly wrapper: CommandWrapper,
  ) {
    this.sessionWorkdir = ctx.root;
    this.sessionAbort = ctx.config.signal;
    if (this.sessionAbort) {
      const fanout = (): void => {
        const snap = Array.from(this.sessionAbortHandlers);
        for (const h of snap) h();
      };
      if (this.sessionAbort.aborted) {
        queueMicrotask(fanout);
      } else {
        this.sessionAbort.addEventListener("abort", fanout, { once: true });
      }
    }
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    if (this.destroyed) throw new Error("env-local-strict: session destroyed");
    if (this.sessionAbort?.aborted) throw new Error("env-local-strict: session aborted");
    if (!this.prepared) {
      await this.wrapper.prepare?.(this.ctx);
      this.prepared = true;
    }
    const cwd = options.cwd ?? this.ctx.root;
    // Strict env: curated host allowlist + per-spawn config.env + per-call env.
    const env: Record<string, string> = {
      ...buildBaseEnv(),
      ...this.ctx.config.env,
      ...options.env,
    };
    // 15c credential-broker proxy: when populated by the runtime, route HTTP
    // libs through the proxy so secrets are rewritten at egress. Both upper-
    // and lower-case variants are needed because curl reads lower-case while
    // Node reads upper. NO_PROXY is explicitly cleared so a host-set bypass
    // list can't disable enforcement. NODE_USE_ENV_PROXY=1 forces older Node
    // (pre-24) http(s) clients to honor the env vars.
    if (this.ctx.config.egressProxy) {
      env.HTTPS_PROXY = this.ctx.config.egressProxy.url;
      env.HTTP_PROXY = this.ctx.config.egressProxy.url;
      env.https_proxy = this.ctx.config.egressProxy.url;
      env.http_proxy = this.ctx.config.egressProxy.url;
      env.NO_PROXY = "";
      env.no_proxy = "";
      env.NODE_USE_ENV_PROXY = "1";
      const caPath = await this.materializeCaPem(this.ctx.config.egressProxy.caPem);
      if (caPath) env.NODE_EXTRA_CA_CERTS = caPath;
    }
    const timeoutMs = options.timeoutMs ?? this.ctx.config.timeoutMs ?? 60_000;
    const maxBytes = this.ctx.config.maxStdoutBytes ?? 1_000_000;

    const start = Date.now();
    const stdinBuf = options.stdin ? new TextEncoder().encode(options.stdin) : undefined;
    const argv = this.wrapper.buildArgv(command, this.ctx);
    const proc = Bun.spawn({
      cmd: argv,
      cwd,
      env,
      stdin: stdinBuf ?? "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const handle: ActiveProc = {
      kill: () => proc.kill("SIGKILL"),
      awaitExit: proc.exited.then(() => undefined),
    };
    this.active.add(handle);

    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    const onAbort = (): void => {
      proc.kill("SIGKILL");
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    this.sessionAbortHandlers.add(onAbort);

    try {
      const [stdoutText, stderrText] = await Promise.all([
        readCapped(proc.stdout, maxBytes),
        readCapped(proc.stderr, maxBytes),
      ]);
      const exitCode = await proc.exited;
      return {
        exitCode: exitCode ?? -1,
        stdout: stdoutText.text,
        stderr: stderrText.text,
        durationMs: Date.now() - start,
        truncated: stdoutText.truncated || stderrText.truncated,
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      this.sessionAbortHandlers.delete(onAbort);
      this.active.delete(handle);
    }
  }

  /**
   * Lazily materialize the egressProxy.caPem bytes into the per-session
   * meta dir so NODE_EXTRA_CA_CERTS can point at a real file path. The
   * runtime hands us PEM contents (string), not a path. v1 proxy emits
   * an empty caPem; the helper no-ops in that case.
   */
  private caPemPath: string | undefined;
  private async materializeCaPem(pem: string): Promise<string | undefined> {
    if (!pem) return undefined;
    if (this.caPemPath) return this.caPemPath;
    this.caPemPath = join(this.ctx.meta, "oddjob-ca.pem");
    await writeFile(this.caPemPath, pem);
    return this.caPemPath;
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const safe = await resolveInsideStrict(this.ctx.root, path);
    await writeFile(safe, content);
  }

  async readFile(path: string): Promise<string> {
    const safe = await resolveInsideStrict(this.ctx.root, path);
    return await readFile(safe, "utf8");
  }

  async kill(): Promise<void> {
    this.destroyed = true;
    const handles = [...this.active];
    for (const h of handles) h.kill();
    await Promise.all(handles.map((h) => h.awaitExit.catch(() => undefined)));
    this.active.clear();
    this.sessionAbortHandlers.clear();
    try {
      await this.wrapper.teardown?.(this.ctx);
    } catch {
      /* ignore */
    }
    const callerSuppliedWorkdir =
      this.ctx.config.config?.workingDir ??
      this.ctx.config.hostWorkdir ??
      this.ctx.config.sessionWorkdir ??
      this.ctx.config.workdir;
    if (!callerSuppliedWorkdir) {
      await rm(this.ctx.root, { recursive: true, force: true });
    }
    await rm(this.ctx.meta, { recursive: true, force: true });
  }
}

/**
 * Build a fresh WrapperContext. If the caller provided a workdir, validate
 * it sits under tmpdir() before accepting — refuses `/`, `~`, etc. The meta
 * dir is always under tmpdir() and we own it.
 */
export async function newWrapperContext(
  config: EnvironmentRunConfig,
  rootPrefix: string,
  metaPrefix: string,
): Promise<WrapperContext> {
  // Strict-local tier: host == session (no namespace boundary). Resolution
  // order matches env-process:
  //   1. EnvironmentConfig.workingDir (operator-declared, per-Environment).
  //   2. Per-spawn hostWorkdir / sessionWorkdir from runtime.
  //   3. Legacy `workdir` alias.
  //   4. Fresh tempdir.
  const callerSuppliedWorkdir =
    config.config?.workingDir ?? config.hostWorkdir ?? config.sessionWorkdir ?? config.workdir;
  let root: string;
  if (callerSuppliedWorkdir) {
    await validateStrictWorkdir(callerSuppliedWorkdir);
    root = callerSuppliedWorkdir;
  } else {
    root = await mkdtemp(join(tmpdir(), rootPrefix));
  }
  const meta = await mkdtemp(join(tmpdir(), metaPrefix));
  return { root, meta, config };
}

async function readCapped(
  stream: ReadableStream<Uint8Array> | null | undefined,
  max: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!stream) return { text: "", truncated: false };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > max) {
        const remaining = Math.max(0, max - total);
        chunks.push(value.subarray(0, remaining));
        truncated = true;
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { text: buf.toString("utf8"), truncated };
}
