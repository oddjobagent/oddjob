import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  EnvironmentProvider,
  EnvironmentRunConfig,
  EnvironmentSession,
  ExecOptions,
  ExecResult,
} from "@oddjob/core";

/**
 * Curated host-env allowlist. The shell needs PATH/HOME/USER/SHELL/TMPDIR to
 * find binaries and settle into a sane default; LANG/LC_ALL avoid encoding
 * surprises. Everything else (including the host's API keys, SSH agent,
 * AWS_* etc.) stays out of the spawned process.
 *
 * The `env` arg on EnvironmentRunConfig is layered on top — that's where the
 * runtime puts placeholders the credential-broker rewrites later (15c).
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

export class ProcessEnvironmentProvider implements EnvironmentProvider {
  readonly name = "env-process";

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return true;
  }

  async spawn(config: EnvironmentRunConfig): Promise<EnvironmentSession> {
    const root = config.workdir ?? (await mkdtemp(join(tmpdir(), "oddjob-sb-")));
    return new ProcessSession(root, config);
  }
}

interface ActiveProc {
  kill: () => void;
  awaitExit: Promise<void>;
}

class ProcessSession implements EnvironmentSession {
  private active = new Set<ActiveProc>();
  private destroyed = false;
  private readonly sessionAbort: AbortSignal | undefined;
  private readonly sessionAbortHandlers = new Set<() => void>();
  private caPemPath: string | undefined;
  private caPemDir: string | undefined;

  constructor(
    private readonly root: string,
    private readonly config: EnvironmentRunConfig,
  ) {
    this.sessionAbort = config.signal;
    if (this.sessionAbort) {
      const fanout = (): void => {
        const snap = Array.from(this.sessionAbortHandlers); for (const h of snap) h();
      };
      if (this.sessionAbort.aborted) {
        // Defer so callers can attach handlers first.
        queueMicrotask(fanout);
      } else {
        this.sessionAbort.addEventListener("abort", fanout, { once: true });
      }
    }
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    if (this.destroyed) throw new Error("env-process: session destroyed");
    if (this.sessionAbort?.aborted) throw new Error("env-process: session aborted");
    const cwd = options.cwd ?? this.root;
    // Strict env: curated host allowlist + per-spawn config.env + per-call env.
    const env: Record<string, string> = { ...buildBaseEnv(), ...this.config.env, ...options.env };
    // 15c credential-broker proxy: when the runtime supplies an egressProxy,
    // wire it into the spawned process so HTTP libs route through it.
    //
    // CAVEAT: env-process is `trusted-tier`. The proxy env vars only
    // intercept clients that respect HTTPS_PROXY (curl, Bun.fetch, Python
    // requests, urllib via NODE_USE_ENV_PROXY). Raw socket calls bypass.
    // For real network containment use local-strict / docker / remote-vm
    // providers (15d/15e/15f).
    if (this.config.egressProxy) {
      env.HTTPS_PROXY = this.config.egressProxy.url;
      env.HTTP_PROXY = this.config.egressProxy.url;
      env.https_proxy = this.config.egressProxy.url;
      env.http_proxy = this.config.egressProxy.url;
      // Explicitly clear NO_PROXY so a host-set bypass list can't disable us.
      env.NO_PROXY = "";
      env.no_proxy = "";
      // Force Node http(s) to honor env proxies (default in Node 24+).
      env.NODE_USE_ENV_PROXY = "1";
      const caPath = await this.materializeCaPem(this.config.egressProxy.caPem);
      if (caPath) env.NODE_EXTRA_CA_CERTS = caPath;
    }
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs ?? 60_000;
    const maxBytes = this.config.maxStdoutBytes ?? 1_000_000;

    const start = Date.now();
    const stdinBuf = options.stdin ? new TextEncoder().encode(options.stdin) : undefined;
    const proc = Bun.spawn({
      cmd: ["sh", "-c", command],
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

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    await writeFile(this.resolveInside(path), content);
  }

  async readFile(path: string): Promise<string> {
    return await readFile(this.resolveInside(path), "utf8");
  }

  /**
   * Lazily materialize the egressProxy.caPem PEM bytes onto disk so we can
   * point NODE_EXTRA_CA_CERTS at a real file path. The runtime hands us the
   * PEM contents (string), not a path. v1 proxy currently sets caPem="";
   * the helper no-ops in that case so we don\u0027t set NODE_EXTRA_CA_CERTS to
   * an invalid path. Cleanup happens in kill().
   */
  private async materializeCaPem(pem: string): Promise<string | undefined> {
    if (!pem) return undefined;
    if (this.caPemPath) return this.caPemPath;
    this.caPemDir = await mkdtemp(join(tmpdir(), "oddjob-ca-"));
    this.caPemPath = join(this.caPemDir, "oddjob-ca.pem");
    await writeFile(this.caPemPath, pem);
    return this.caPemPath;
  }

  /**
   * env-process has trustTier=trusted so absolute paths outside workdir are
   * permitted by design (callers that want strict containment should use
   * env-local-strict). We still refuse `..` traversal in *relative* paths to
   * avoid accidental escapes.
   */
  private resolveInside(path: string): string {
    if (isAbsolute(path)) return path;
    const abs = resolve(this.root, path);
    const rel = relative(this.root, abs);
    if (rel.startsWith("..") || rel.split(sep).includes("..")) {
      throw new Error(`env-process: refusing relative path traversal outside workdir: ${path}`);
    }
    return abs;
  }

  async kill(): Promise<void> {
    this.destroyed = true;
    const handles = [...this.active];
    for (const h of handles) h.kill();
    await Promise.all(handles.map((h) => h.awaitExit.catch(() => undefined)));
    this.active.clear();
    this.sessionAbortHandlers.clear();
    if (!this.config.workdir) {
      await rm(this.root, { recursive: true, force: true });
    }
    if (this.caPemDir) {
      await rm(this.caPemDir, { recursive: true, force: true }).catch(() => undefined);
      this.caPemDir = undefined;
      this.caPemPath = undefined;
    }
  }
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
