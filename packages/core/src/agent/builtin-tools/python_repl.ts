import type { Static } from "typebox";
import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import type { LogEntry } from "../../providers/logging.ts";

const schema = Type.Object({
  code: Type.String({
    description:
      "Python source. Runs via `python3 -c <code>`. Use print() for output. Requires python3 on PATH.",
  }),
  timeout_ms: Type.Optional(
    Type.Number({ description: "Override execution timeout (default: 30000)." }),
  ),
});
type Input = Static<typeof schema>;

interface Details {
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface PythonReplOptions {
  defaultTimeoutMs?: number;
  onLog?: (entry: LogEntry) => void;
  /** Override binary (default: "python3"). For tests / pinning. */
  pythonBin?: string;
}

const HEAD_BYTES = 256 * 1024;

// NOTE: Pyodide (Python WASM) was the original v14 plan, but emscripten/Bun has the same
// `freeHostRef` GC issue we hit with QuickJS, AND the WASM is ~10 MB which would push the
// binary past budget. python3 subprocess gives us a working tool today; cloud sandboxes
// (E2B/Modal) land in Phase 15 and can replace this with a real boundary.
export function createPythonReplTool(opts: PythonReplOptions = {}): AgentTool<typeof schema> {
  const defaultTimeout = opts.defaultTimeoutMs ?? 30_000;
  const bin = opts.pythonBin ?? "python3";
  return {
    name: "python_repl",
    label: "Python REPL",
    description:
      "Execute Python via `python3 -c`. Requires python3 on PATH. NOT a security sandbox — same trust posture as `bash`.",
    parameters: schema,
    async execute(_id, params: Input, signal): Promise<AgentToolResult<Details>> {
      const start = Date.now();
      const timeoutMs = params.timeout_ms ?? defaultTimeout;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(new Error("python_repl timeout")), timeoutMs);
      const onAbort = () => ctl.abort();
      signal?.addEventListener("abort", onAbort);
      try {
        const proc = Bun.spawn({
          cmd: [bin, "-c", params.code],
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
          signal: ctl.signal,
        });
        const [stdoutText, stderrText, exitCode] = await Promise.all([
          readCapped(proc.stdout),
          readCapped(proc.stderr),
          proc.exited,
        ]);
        const durationMs = Date.now() - start;
        opts.onLog?.({
          timestamp: Date.now(),
          level: exitCode === 0 ? "info" : "warn",
          message: `python_repl exit=${exitCode} in ${durationMs}ms`,
        });
        const text = formatOutput(exitCode, stdoutText, stderrText);
        return {
          content: [{ type: "text", text }],
          details: { exitCode, durationMs, stdout: stdoutText, stderr: stderrText },
        };
      } catch (err) {
        const message = (err as Error).message ?? "spawn failed";
        return {
          content: [
            {
              type: "text",
              text:
                message.includes("ENOENT") || message.includes("not found")
                  ? `python_repl error: '${bin}' not found on PATH. Install Python 3 or set [builtin_tools.python_repl].bin in config.`
                  : `python_repl error: ${message}`,
            },
          ],
          details: { exitCode: -1, durationMs: Date.now() - start, stdout: "", stderr: "" },
        };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

async function readCapped(stream: ReadableStream<Uint8Array> | undefined | null): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.length > HEAD_BYTES) {
      chunks.push(value.slice(0, HEAD_BYTES - total));
      total = HEAD_BYTES;
      reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(buf);
}

function formatOutput(exitCode: number, stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout) parts.push(stdout.trimEnd());
  if (stderr) parts.push(`[stderr]\n${stderr.trimEnd()}`);
  if (exitCode !== 0) parts.push(`[exit ${exitCode}]`);
  return parts.length > 0 ? parts.join("\n") : "(no output)";
}
