import type { Static } from "typebox";
import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import type { LogEntry } from "@oddjob/core";
import type { EnvironmentSession } from "@oddjob/core";

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
  /**
   * Required: environment session. The REPL runs `python3 -c <code>` inside
   * the session so it inherits the environment's sandbox (seatbelt / bwrap /
   * docker / daytona) and proxy.
   */
  environment: EnvironmentSession;
  defaultTimeoutMs?: number;
  onLog?: (entry: LogEntry) => void;
  /** Override binary (default: "python3"). For tests / pinning. */
  pythonBin?: string;
}

// NOTE: Pyodide (Python WASM) was the original v14 plan, but emscripten/Bun has the same
// `freeHostRef` GC issue we hit with QuickJS, AND the WASM is ~10 MB. python3 via the
// environment session gives us a working tool today AND the proper boundary in Phase 15.
export function createPythonReplTool(opts: PythonReplOptions): AgentTool<typeof schema> {
  const defaultTimeout = opts.defaultTimeoutMs ?? 30_000;
  const bin = opts.pythonBin ?? "python3";
  return {
    name: "python_repl",
    label: "Python REPL",
    description:
      "Execute Python via `python3 -c`. Requires python3 on PATH inside the environment. Runs inside the run's environment.",
    parameters: schema,
    async execute(_id, params: Input, signal): Promise<AgentToolResult<Details>> {
      const start = Date.now();
      const timeoutMs = params.timeout_ms ?? defaultTimeout;
      try {
        const r = await runViaSession(opts.environment, bin, params.code, timeoutMs, signal);
        const durationMs = Date.now() - start;
        opts.onLog?.({
          timestamp: Date.now(),
          level: r.exitCode === 0 ? "info" : "warn",
          message: `python_repl exit=${r.exitCode} in ${durationMs}ms`,
        });
        if (r.exitCode !== 0 && /not found|No such file|command not found/i.test(r.stderr)) {
          return {
            content: [
              {
                type: "text",
                text: `python_repl error: '${bin}' not found inside the environment. Add 'python3' to environment.config.packages.apt or set [builtin_tools.python_repl].bin in config.`,
              },
            ],
            details: { exitCode: r.exitCode, durationMs, stdout: r.stdout, stderr: r.stderr },
          };
        }
        const text = formatOutput(r.exitCode, r.stdout, r.stderr);
        return {
          content: [{ type: "text", text }],
          details: { exitCode: r.exitCode, durationMs, stdout: r.stdout, stderr: r.stderr },
        };
      } catch (err) {
        const message = (err as Error).message ?? "spawn failed";
        return {
          content: [{ type: "text", text: `python_repl error: ${message}` }],
          details: { exitCode: -1, durationMs: Date.now() - start, stdout: "", stderr: "" },
        };
      }
    },
  };
}

async function runViaSession(
  env: EnvironmentSession,
  bin: string,
  code: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return env.exec(`${bin} -c ${shellQuote(code)}`, { timeoutMs, signal });
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function formatOutput(exitCode: number, stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout) parts.push(stdout.trimEnd());
  if (stderr) parts.push(`[stderr]\n${stderr.trimEnd()}`);
  if (exitCode !== 0) parts.push(`[exit ${exitCode}]`);
  return parts.length > 0 ? parts.join("\n") : "(no output)";
}
