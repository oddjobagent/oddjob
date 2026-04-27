import type { Static } from "typebox";
import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import type { LogEntry } from "../../providers/logging.ts";

const schema = Type.Object({
  code: Type.String({
    description:
      "JavaScript or TypeScript source. Last expression is returned. Runs via `bun -e`. Top-level await supported.",
  }),
  timeout_ms: Type.Optional(
    Type.Number({ description: "Override execution timeout (default: 10000)." }),
  ),
});
type Input = Static<typeof schema>;

interface Details {
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface JsReplOptions {
  defaultTimeoutMs?: number;
  defaultMemoryMb?: number;
  onLog?: (entry: LogEntry) => void;
  /** Override the binary used to run code (default: process.execPath). For tests. */
  bunBin?: string;
}

const HEAD_BYTES = 256 * 1024;

// NOTE: We tried `@sebastianwessel/quickjs` (QuickJS WASM) for true in-process sandboxing.
// Both sync + asyncify variants crash on Bun with `freeHostRef is not a function` during
// disposal — quickjs-emscripten's host-callback registration isn't compatible with Bun's
// dynamic-import path for emscripten modules. Until upstream fixes that, we shell out to
// `bun -e`. Process isolation only — same trust posture as `bash`. Cloud sandbox boundary
// is a Phase-15 concern.
export function createJavascriptReplTool(opts: JsReplOptions = {}): AgentTool<typeof schema> {
  const defaultTimeout = opts.defaultTimeoutMs ?? 10_000;
  const bin = opts.bunBin ?? process.execPath;
  return {
    name: "javascript_repl",
    label: "JavaScript REPL",
    description:
      "Execute JavaScript / TypeScript via `bun -e`. Top-level await is supported. console.log output is captured. NOT a security sandbox.",
    parameters: schema,
    async execute(_id, params: Input, signal): Promise<AgentToolResult<Details>> {
      const start = Date.now();
      const timeoutMs = params.timeout_ms ?? defaultTimeout;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(new Error("javascript_repl timeout")), timeoutMs);
      const onAbort = () => ctl.abort();
      signal?.addEventListener("abort", onAbort);

      try {
        const proc = Bun.spawn({
          cmd: [bin, "-e", params.code],
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
          message: `javascript_repl exit=${exitCode} in ${durationMs}ms`,
        });
        const text = formatOutput(exitCode, stdoutText, stderrText);
        return {
          content: [{ type: "text", text }],
          details: {
            exitCode,
            durationMs,
            stdout: stdoutText,
            stderr: stderrText,
          },
        };
      } catch (err) {
        const durationMs = Date.now() - start;
        return {
          content: [
            { type: "text", text: `javascript_repl error: ${(err as Error).message}` },
          ],
          details: { exitCode: -1, durationMs, stdout: "", stderr: "" },
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
