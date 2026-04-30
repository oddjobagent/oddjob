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

// Subprocess-based Python executor. Runs `python3 -c <code>` inside the
// environment session so it inherits the run's sandbox + egress proxy. The
// session must have `python3` (or `uv`) on PATH; pass a custom `pythonBin`
// to use uv: `pythonBin: "uv run python"`.
export function createPythonTool(opts: PythonReplOptions): AgentTool<typeof schema> {
  const defaultTimeout = opts.defaultTimeoutMs ?? 30_000;
  const bin = opts.pythonBin ?? "python3";
  return {
    name: "python",
    label: "Python",
    description:
      "Execute Python via `python3 -c`. Requires python3 (or uv) on PATH inside the environment.",
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
          message: `python exit=${r.exitCode} in ${durationMs}ms`,
        });
        if (r.exitCode !== 0 && /not found|No such file|command not found/i.test(r.stderr)) {
          return {
            content: [
              {
                type: "text",
                text: `python error: '${bin}' not found inside the environment. Install python3 (or uv) in the environment image.`,
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
          content: [{ type: "text", text: `python error: ${message}` }],
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
