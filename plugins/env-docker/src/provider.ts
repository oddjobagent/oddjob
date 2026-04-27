import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  EnvironmentProvider,
  EnvironmentRunConfig,
  EnvironmentSession,
  ExecOptions,
  ExecResult,
} from "@oddjob/core";

const DEFAULT_IMAGE = "oddjob/runtime:latest";

interface RunDockerArgs {
  argv: string[];
  stdin?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxStdoutBytes?: number;
}

interface RunDockerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

/**
 * Spawn the `docker` CLI and return the result. We deliberately do NOT
 * route through a shell here — argv is passed directly to docker so we
 * avoid any shell quoting concerns on the wrapper layer.
 */
async function runDocker(args: RunDockerArgs): Promise<RunDockerResult> {
  const start = Date.now();
  const stdinBuf = args.stdin ? new TextEncoder().encode(args.stdin) : undefined;
  const proc = Bun.spawn({
    cmd: args.argv,
    stdin: stdinBuf ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = args.timeoutMs
    ? setTimeout(() => proc.kill("SIGKILL"), args.timeoutMs)
    : undefined;
  const onAbort = (): void => {
    proc.kill("SIGKILL");
  };
  args.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const max = args.maxStdoutBytes ?? 1_000_000;
    const [out, err] = await Promise.all([
      readCapped(proc.stdout, max),
      readCapped(proc.stderr, max),
    ]);
    const exitCode = await proc.exited;
    return {
      exitCode: exitCode ?? -1,
      stdout: out.text,
      stderr: err.text,
      durationMs: Date.now() - start,
      truncated: out.truncated || err.truncated,
    };
  } finally {
    if (timer) clearTimeout(timer);
    args.signal?.removeEventListener("abort", onAbort);
  }
}

async function dockerInfo(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const r = await runDocker({ argv: ["docker", "info", "--format", "{{.ServerVersion}}"], timeoutMs: 5000 });
    if (r.exitCode === 0 && r.stdout.trim().length > 0) return { ok: true };
    return { ok: false, reason: r.stderr.trim().split("\n")[0] || "docker info returned empty" };
  } catch (err) {
    return { ok: false, reason: (err as Error).message ?? "docker CLI not on PATH" };
  }
}

export { dockerInfo };

export class DockerEnvironmentProvider implements EnvironmentProvider {
  readonly name = "env-docker";

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return (await dockerInfo()).ok;
  }

  async spawn(config: EnvironmentRunConfig): Promise<EnvironmentSession> {
    const image = config.config?.image ?? DEFAULT_IMAGE;
    const containerName = `oddjob-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Per-session host-side workdir bind-mounted into the container at /work.
    const hostWorkdir = config.workdir ?? (await mkdtemp(join(tmpdir(), "oddjob-docker-")));

    // Build env file so secrets don't leak via `ps auxe`.
    const envFile = join(hostWorkdir, ".oddjob-env");
    const envLines = Object.entries(config.env ?? {}).map(([k, v]) => `${k}=${v}`);
    if (config.egressProxy) {
      const u = config.egressProxy.url;
      envLines.push(`HTTPS_PROXY=${u}`);
      envLines.push(`HTTP_PROXY=${u}`);
      envLines.push(`https_proxy=${u}`);
      envLines.push(`http_proxy=${u}`);
      envLines.push(`NO_PROXY=`);
      envLines.push(`no_proxy=`);
      envLines.push(`NODE_USE_ENV_PROXY=1`);
      // CA materialised inside the workdir bind so the container can read it.
      if (config.egressProxy.caPem) {
        const caPath = join(hostWorkdir, ".oddjob-ca.pem");
        await writeFile(caPath, config.egressProxy.caPem);
        envLines.push(`NODE_EXTRA_CA_CERTS=/work/.oddjob-ca.pem`);
      }
    }
    await writeFile(envFile, envLines.join("\n") + "\n");

    const runArgv = [
      "docker",
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "-v",
      `${hostWorkdir}:/work`,
      "-w",
      "/work",
      "--env-file",
      envFile,
      image,
      "sleep",
      "infinity",
    ];
    const r = await runDocker({ argv: runArgv, timeoutMs: 60_000 });
    if (r.exitCode !== 0) {
      throw new Error(`env-docker: failed to start container: ${r.stderr.trim() || r.stdout.trim()}`);
    }
    return new DockerSession({
      containerName,
      hostWorkdir,
      ownsWorkdir: !config.workdir,
      timeoutMs: config.timeoutMs,
      maxStdoutBytes: config.maxStdoutBytes,
      sessionAbort: config.signal,
    });
  }
}

interface DockerSessionInit {
  containerName: string;
  hostWorkdir: string;
  ownsWorkdir: boolean;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  sessionAbort?: AbortSignal;
}

export class DockerSession implements EnvironmentSession {
  private destroyed = false;
  private readonly sessionAbort?: AbortSignal;
  private readonly sessionAbortHandlers = new Set<() => void>();

  constructor(private readonly init: DockerSessionInit) {
    this.sessionAbort = init.sessionAbort;
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
    if (this.destroyed) throw new Error("env-docker: session destroyed");
    if (this.sessionAbort?.aborted) throw new Error("env-docker: session aborted");
    const cwd = options.cwd ?? "/work";
    const argv: string[] = ["docker", "exec", "-i"];
    if (options.env) {
      for (const [k, v] of Object.entries(options.env)) {
        argv.push("-e", `${k}=${v}`);
      }
    }
    argv.push("-w", cwd, this.init.containerName, "sh", "-c", command);

    const onAbort = (): void => {
      // SIGKILL the container so the `docker exec` returns immediately.
      void runDocker({ argv: ["docker", "kill", this.init.containerName], timeoutMs: 5000 });
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    this.sessionAbortHandlers.add(onAbort);

    try {
      return await runDocker({
        argv,
        stdin: options.stdin,
        timeoutMs: options.timeoutMs ?? this.init.timeoutMs ?? 60_000,
        signal: options.signal,
        maxStdoutBytes: this.init.maxStdoutBytes,
      });
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      this.sessionAbortHandlers.delete(onAbort);
    }
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    if (this.destroyed) throw new Error("env-docker: session destroyed");
    // Write via the host bind-mount so we don't need a docker cp round-trip.
    // path is resolved INSIDE /work on the host; absolute paths go through
    // `docker exec sh -c "cat >..."` for safety. v1 only supports relative
    // paths inside /work.
    if (path.startsWith("/")) {
      const proc = await runDocker({
        argv: [
          "docker",
          "exec",
          "-i",
          this.init.containerName,
          "sh",
          "-c",
          `cat > ${shellQuote(path)}`,
        ],
        stdin: typeof content === "string" ? content : Buffer.from(content).toString("utf8"),
        timeoutMs: 30_000,
      });
      if (proc.exitCode !== 0) {
        throw new Error(`env-docker: writeFile failed: ${proc.stderr.trim()}`);
      }
      return;
    }
    await writeFile(join(this.init.hostWorkdir, path), content);
  }

  async readFile(path: string): Promise<string> {
    if (this.destroyed) throw new Error("env-docker: session destroyed");
    if (path.startsWith("/")) {
      const r = await runDocker({
        argv: [
          "docker",
          "exec",
          "-i",
          this.init.containerName,
          "sh",
          "-c",
          `cat ${shellQuote(path)}`,
        ],
        timeoutMs: 30_000,
      });
      if (r.exitCode !== 0) {
        throw new Error(`env-docker: readFile failed: ${r.stderr.trim()}`);
      }
      return r.stdout;
    }
    return await readFile(join(this.init.hostWorkdir, path), "utf8");
  }

  async kill(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sessionAbortHandlers.clear();
    // Best-effort container kill; --rm cleans up automatically.
    await runDocker({
      argv: ["docker", "kill", this.init.containerName],
      timeoutMs: 10_000,
    }).catch(() => undefined);
    if (this.init.ownsWorkdir) {
      await rm(this.init.hostWorkdir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async pause(): Promise<void> {
    if (this.destroyed) throw new Error("env-docker: session destroyed");
    await runDocker({ argv: ["docker", "pause", this.init.containerName], timeoutMs: 10_000 });
  }

  async resume(): Promise<void> {
    if (this.destroyed) throw new Error("env-docker: session destroyed");
    await runDocker({ argv: ["docker", "unpause", this.init.containerName], timeoutMs: 10_000 });
  }
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
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
