import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";

import type {
  EnvironmentProvider,
  EnvironmentRunConfig,
  EnvironmentSession,
  ExecOptions,
  ExecResult,
} from "@oddjob/core";

const DEFAULT_IMAGE = "oddjob/runtime:latest";

export interface RunDockerArgs {
  argv: string[];
  stdin?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxStdoutBytes?: number;
}

export interface RunDockerResult {
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
  const timer = args.timeoutMs ? setTimeout(() => proc.kill("SIGKILL"), args.timeoutMs) : undefined;
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

/**
 * Resolve the docker bridge network's gateway IP (the address container
 * traffic emerges from when reaching the host). Returns undefined on any
 * failure path — caller should fall back to the runtime default.
 */
async function discoverDockerBridgeGateway(
  runDocker: (args: RunDockerArgs) => Promise<RunDockerResult>,
): Promise<string | undefined> {
  const r = await runDocker({
    argv: [
      "docker",
      "network",
      "inspect",
      "bridge",
      "--format",
      "{{(index .IPAM.Config 0).Gateway}}",
    ],
    timeoutMs: 5000,
  }).catch(() => undefined);
  if (!r || r.exitCode !== 0) return undefined;
  const ip = r.stdout.trim();
  // Validate shape so we don't pass garbage into Bun.listen on a parse fail
  // from an exotic docker setup. IPv4 dotted-quad only — bridge gateway is
  // always v4 in practice.
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return undefined;
  return ip;
}

async function dockerInfo(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const r = await runDocker({
      argv: ["docker", "info", "--format", "{{.ServerVersion}}"],
      timeoutMs: 5000,
    });
    if (r.exitCode === 0 && r.stdout.trim().length > 0) return { ok: true };
    return { ok: false, reason: r.stderr.trim().split("\n")[0] || "docker info returned empty" };
  } catch (err) {
    return { ok: false, reason: (err as Error).message ?? "docker CLI not on PATH" };
  }
}

export { dockerInfo };

export interface DockerEnvironmentProviderOptions {
  /**
   * Test seam: replace the docker CLI invocation with a stub so unit tests can
   * assert on argv (workdir bind shape, host-gateway flag, env-file contents)
   * without requiring a live docker daemon.
   */
  runDocker?: (args: RunDockerArgs) => Promise<RunDockerResult>;
}

export class DockerEnvironmentProvider implements EnvironmentProvider {
  readonly name = "env-docker";
  private readonly runDocker: (args: RunDockerArgs) => Promise<RunDockerResult>;

  constructor(opts: DockerEnvironmentProviderOptions = {}) {
    this.runDocker = opts.runDocker ?? runDocker;
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return (await dockerInfo()).ok;
  }

  /**
   * 15i-2 fix: tell the runtime where to bind the egress proxy so the
   * container can actually reach it.
   *
   * - Linux: Docker engine routes container→host via the bridge gateway IP
   *   (typically 172.17.0.1). A proxy bound on host loopback (127.0.0.1)
   *   accepts no connections from there. We discover the bridge IP via
   *   `docker network inspect bridge` and return it. Per-Run Proxy-Auth
   *   already gates every request, so binding off-loopback does not weaken
   *   authentication; it only widens the accept set.
   *
   *   Codex round-2 follow-up: on bridge discovery failure we now THROW
   *   rather than fall back to loopback. Silent fallback was the bug
   *   that made the round-1 fix ineffective on Linux. The runtime catches
   *   and fails the run with a clear message.
   * - Mac / Windows: Docker Desktop forwards `host.docker.internal` to the
   *   host's loopback automatically, so 127.0.0.1 keeps working. Returning
   *   undefined here means "no opinion; runtime default (loopback) is fine".
   */
  async proxyBindAddress(): Promise<string | undefined> {
    if (platform() !== "linux") return undefined;
    const ip = await discoverDockerBridgeGateway(this.runDocker);
    if (!ip) {
      throw new Error(
        "env-docker: cannot discover the docker bridge gateway IP via " +
          "`docker network inspect bridge`. The egress proxy must bind on " +
          "that IP for the container to reach it (container's 127.0.0.1 is " +
          "the container itself). Check that the docker daemon is running " +
          "and the default `bridge` network exists, or fall back to " +
          "env-process for trusted-tier dev runs.",
      );
    }
    return ip;
  }

  async spawn(config: EnvironmentRunConfig): Promise<EnvironmentSession> {
    const image = config.config?.image ?? DEFAULT_IMAGE;
    const containerName = `oddjob-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Container tier: hostWorkdir is a HOST path (bind-mount source);
    // sessionWorkdir is the in-container path (bind target + cwd for tools).
    // Pre-15i callers using the legacy `workdir` field get treated as host
    // (with sessionWorkdir defaulting to "/work").
    const hostWorkdir =
      config.hostWorkdir ?? config.workdir ?? (await mkdtemp(join(tmpdir(), "oddjob-docker-")));
    const callerSuppliedHost = !!(config.hostWorkdir ?? config.workdir);
    const sessionWorkdir = config.sessionWorkdir ?? "/work";

    // Build env file so secrets don't leak via `ps auxe`. Track every host
    // path we materialise inside the (possibly caller-owned) workdir so
    // kill() can unlink them later even when we don't own the dir itself.
    // .oddjob-env carries the per-Run proxy auth token; persisting it after
    // the run ends would leak credentials into the operator's filesystem.
    const emittedArtifacts: string[] = [];
    const envFile = join(hostWorkdir, ".oddjob-env");
    emittedArtifacts.push(envFile);
    const envLines = Object.entries(config.env ?? {}).map(([k, v]) => `${k}=${v}`);
    // 15i-2: when the runtime hands us a proxy bound to a host-side address
    // unreachable from inside the container (loopback or RFC1918 such as the
    // docker bridge gateway), rewrite the hostname to `host.docker.internal`
    // and add `--add-host host.docker.internal:host-gateway` so Linux
    // engines >=20.10 resolve the alias to the docker-host gateway IP (Mac/
    // Windows Docker Desktop ship the alias built-in). The runtime's
    // proxyBindAddress() hook (this.proxyBindAddress) lets the proxy bind on
    // that gateway IP so the container can actually connect.
    let needsHostGateway = false;
    if (config.egressProxy) {
      const proxyUrl = rewriteProxyForContainer(config.egressProxy.url);
      needsHostGateway = proxyUrl !== config.egressProxy.url;
      envLines.push(`HTTPS_PROXY=${proxyUrl}`);
      envLines.push(`HTTP_PROXY=${proxyUrl}`);
      envLines.push(`https_proxy=${proxyUrl}`);
      envLines.push(`http_proxy=${proxyUrl}`);
      envLines.push(`NO_PROXY=`);
      envLines.push(`no_proxy=`);
      envLines.push(`NODE_USE_ENV_PROXY=1`);
      // CA materialised inside the workdir bind so the container can read it.
      if (config.egressProxy.caPem) {
        const caPath = join(hostWorkdir, ".oddjob-ca.pem");
        await writeFile(caPath, config.egressProxy.caPem);
        emittedArtifacts.push(caPath);
        envLines.push(`NODE_EXTRA_CA_CERTS=${sessionWorkdir}/.oddjob-ca.pem`);
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
      `${hostWorkdir}:${sessionWorkdir}`,
      "-w",
      sessionWorkdir,
      "--env-file",
      envFile,
    ];
    if (needsHostGateway) {
      runArgv.push("--add-host", "host.docker.internal:host-gateway");
    }
    runArgv.push(image, "sleep", "infinity");
    const r = await this.runDocker({ argv: runArgv, timeoutMs: 60_000 });
    if (r.exitCode !== 0) {
      throw new Error(
        `env-docker: failed to start container: ${r.stderr.trim() || r.stdout.trim()}`,
      );
    }
    return new DockerSession({
      containerName,
      hostWorkdir,
      sessionWorkdir,
      ownsWorkdir: !callerSuppliedHost,
      emittedArtifacts,
      timeoutMs: config.timeoutMs,
      maxStdoutBytes: config.maxStdoutBytes,
      sessionAbort: config.signal,
      runDocker: this.runDocker,
    });
  }
}

interface DockerSessionInit {
  containerName: string;
  hostWorkdir: string;
  /**
   * Path INSIDE the container that hostWorkdir is bind-mounted at; tools
   * receive this as their default cwd via `session.sessionWorkdir`.
   */
  sessionWorkdir: string;
  ownsWorkdir: boolean;
  /**
   * Host paths the spawn step materialised inside `hostWorkdir` (env file,
   * CA cert). kill() unlinks each individually so the per-Run proxy auth
   * token in `.oddjob-env` does not persist when the workdir is caller-owned.
   */
  emittedArtifacts: readonly string[];
  timeoutMs?: number;
  maxStdoutBytes?: number;
  sessionAbort?: AbortSignal;
  runDocker?: (args: RunDockerArgs) => Promise<RunDockerResult>;
}

export class DockerSession implements EnvironmentSession {
  private destroyed = false;
  private readonly sessionAbort?: AbortSignal;
  private readonly sessionAbortHandlers = new Set<() => void>();
  readonly sessionWorkdir: string;
  private readonly runDocker: (args: RunDockerArgs) => Promise<RunDockerResult>;

  constructor(private readonly init: DockerSessionInit) {
    this.sessionWorkdir = init.sessionWorkdir;
    this.runDocker = init.runDocker ?? runDocker;
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
    const cwd = options.cwd ?? this.init.sessionWorkdir;
    const argv: string[] = ["docker", "exec", "-i"];
    if (options.env) {
      for (const [k, v] of Object.entries(options.env)) {
        argv.push("-e", `${k}=${v}`);
      }
    }
    argv.push("-w", cwd, this.init.containerName, "sh", "-c", command);

    const onAbort = (): void => {
      // SIGKILL the container so the `docker exec` returns immediately.
      void this.runDocker({ argv: ["docker", "kill", this.init.containerName], timeoutMs: 5000 });
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    this.sessionAbortHandlers.add(onAbort);

    try {
      return await this.runDocker({
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
      const proc = await this.runDocker({
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
      const r = await this.runDocker({
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
    await this.runDocker({
      argv: ["docker", "kill", this.init.containerName],
      timeoutMs: 10_000,
    }).catch(() => undefined);
    if (this.init.ownsWorkdir) {
      // We created the workdir ourselves; rm it wholesale (also clears the
      // emitted artifacts inside it).
      await rm(this.init.hostWorkdir, { recursive: true, force: true }).catch(() => undefined);
    } else {
      // Caller owns the dir — keep their files but unlink each artifact we
      // wrote so the per-Run proxy auth token (in .oddjob-env) and the
      // proxy CA bytes (in .oddjob-ca.pem) don't persist after the run.
      for (const p of this.init.emittedArtifacts) {
        await rm(p, { force: true }).catch(() => undefined);
      }
    }
  }

  async pause(): Promise<void> {
    if (this.destroyed) throw new Error("env-docker: session destroyed");
    await this.runDocker({
      argv: ["docker", "pause", this.init.containerName],
      timeoutMs: 10_000,
    });
  }

  async resume(): Promise<void> {
    if (this.destroyed) throw new Error("env-docker: session destroyed");
    await this.runDocker({
      argv: ["docker", "unpause", this.init.containerName],
      timeoutMs: 10_000,
    });
  }
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Rewrite a proxy URL whose host is unreachable from inside the container —
 * loopback (127.0.0.1 / localhost) or an RFC1918 host-side address such as
 * the docker bridge gateway (172.17.0.1) — to use the container-side
 * `host.docker.internal` alias. Public IPs and public DNS names pass through
 * unchanged so an operator-supplied remote proxy still works.
 *
 * Container resolves `host.docker.internal` via the
 * `--add-host=...:host-gateway` directive added to the docker run argv. On
 * Linux that resolves to the bridge gateway IP, which is exactly where the
 * runtime bound the proxy after `proxyBindAddress()` was consulted.
 */
function rewriteProxyForContainer(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname;
  if (host === "127.0.0.1" || host === "localhost" || isPrivateIpv4(host)) {
    parsed.hostname = "host.docker.internal";
    return parsed.toString();
  }
  return url;
}

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  // RFC1918: 10/8, 172.16/12, 192.168/16. Plus link-local 169.254/16.
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
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
