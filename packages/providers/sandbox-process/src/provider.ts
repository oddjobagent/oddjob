import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import type {
  EnvironmentProvider,
  EnvironmentRunConfig,
  EnvironmentSession,
  ExecOptions,
  ExecResult,
} from "@oddjob/core";

export class SandboxProcessProvider implements EnvironmentProvider {
  readonly name = "sandbox-process";

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

  constructor(
    private readonly root: string,
    private readonly config: EnvironmentRunConfig,
  ) {}

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    if (this.destroyed) throw new Error("sandbox: session destroyed");
    const cwd = options.cwd ?? this.root;
    const env = { ...process.env, ...this.config.env, ...options.env };
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
    const onAbort = () => proc.kill("SIGKILL");
    options.signal?.addEventListener("abort", onAbort, { once: true });

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
      this.active.delete(handle);
    }
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    await writeFile(this.resolveInside(path), content);
  }

  async readFile(path: string): Promise<string> {
    return await readFile(this.resolveInside(path), "utf8");
  }

  private resolveInside(path: string): string {
    return isAbsolute(path) ? path : join(this.root, path);
  }

  async kill(): Promise<void> {
    this.destroyed = true;
    const handles = [...this.active];
    for (const h of handles) h.kill();
    await Promise.all(handles.map((h) => h.awaitExit.catch(() => undefined)));
    this.active.clear();
    if (!this.config.workdir) {
      await rm(this.root, { recursive: true, force: true });
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
