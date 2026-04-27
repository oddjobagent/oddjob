import type { Static } from "typebox";
import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import type { LogEntry } from "../../providers/logging.ts";
import type { EnvironmentSession } from "../../providers/environment.ts";

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
  /**
   * Required: environment session that owns the executor. The REPL runs
   * `<bun> -e <code>` inside the session so it inherits the environment's
   * sandbox (seatbelt / bwrap / docker / daytona) and proxy.
   */
  environment: EnvironmentSession;
  defaultTimeoutMs?: number;
  defaultMemoryMb?: number;
  onLog?: (entry: LogEntry) => void;
  /** Override the binary used to run code (default: "bun"). For tests / pinning. */
  bunBin?: string;
}

// NOTE: We tried `@sebastianwessel/quickjs` (QuickJS WASM) for true in-process sandboxing.
// Both sync + asyncify variants crash on Bun with `freeHostRef is not a function` during
// disposal. Until upstream fixes that, we shell out via the environment session, which
// gives us a real isolation boundary (seatbelt/bwrap/docker/daytona).
export function createJavascriptReplTool(opts: JsReplOptions): AgentTool<typeof schema> {
  const defaultTimeout = opts.defaultTimeoutMs ?? 10_000;
  const bin = opts.bunBin ?? "bun";
  return {
    name: "javascript_repl",
    label: "JavaScript REPL",
    description:
      "Execute JavaScript / TypeScript via `bun -e`. Top-level await is supported. console.log output is captured. Runs inside the run's environment.",
    parameters: schema,
    async execute(_id, params: Input, signal): Promise<AgentToolResult<Details>> {
      const start = Date.now();
      const timeoutMs = params.timeout_ms ?? defaultTimeout;
      try {
        const r = await opts.environment.exec(`${bin} -e ${shellQuote(params.code)}`, {
          timeoutMs,
          signal,
        });
        const durationMs = Date.now() - start;
        opts.onLog?.({
          timestamp: Date.now(),
          level: r.exitCode === 0 ? "info" : "warn",
          message: `javascript_repl exit=${r.exitCode} in ${durationMs}ms`,
        });
        const text = formatOutput(r.exitCode, r.stdout, r.stderr);
        return {
          content: [{ type: "text", text }],
          details: {
            exitCode: r.exitCode,
            durationMs,
            stdout: r.stdout,
            stderr: r.stderr,
          },
        };
      } catch (err) {
        const durationMs = Date.now() - start;
        return {
          content: [{ type: "text", text: `javascript_repl error: ${(err as Error).message}` }],
          details: { exitCode: -1, durationMs, stdout: "", stderr: "" },
        };
      }
    },
  };
}

function formatOutput(exitCode: number, stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout) parts.push(stdout.trimEnd());
  if (stderr) parts.push(`[stderr]\n${stderr.trimEnd()}`);
  if (exitCode !== 0) parts.push(`[exit ${exitCode}]`);
  return parts.length > 0 ? parts.join("\n") : "(no output)";
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
