/**
 * `notes_append` / `notes_read` — session-local scratchpad tool.
 *
 * Backed by `<session.cwd>/.oddjob/notes.md`. Persists across tool calls
 * within a single run; survives compaction by reference.
 *
 * Notes are organized by `key` so the agent can write structured plans /
 * journals without cross-contamination between unrelated subtasks.
 *
 * Filesystem semantics: writes go through the session's run helper, which
 * invokes a shell builtin inside the sandbox. Coordination convention, not
 * a security boundary.
 */

import type { Static } from "typebox";
import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import type { EnvironmentSession } from "@oddjob/core";

import { shellQuote } from "./coding-adapter.ts";

const NOTES_DIR = ".oddjob";
const NOTES_FILE = ".oddjob/notes.md";

const appendSchema = Type.Object({
  key: Type.String({
    description:
      "Short identifier for this note. Reusing the same key appends additional content under the same heading.",
    minLength: 1,
    maxLength: 64,
  }),
  text: Type.String({
    description: "Markdown content to append. A timestamp + heading are added automatically.",
    minLength: 1,
  }),
});

const readSchema = Type.Object({
  key: Type.Optional(
    Type.String({
      description: "Optional key filter — only return entries whose key matches.",
      minLength: 1,
    }),
  ),
});

type AppendInput = Static<typeof appendSchema>;
type ReadInput = Static<typeof readSchema>;

export interface NotesToolOptions {
  environment: EnvironmentSession;
  /** Override clock for tests. */
  now?: () => Date;
}

export function createNotesAppendTool(opts: NotesToolOptions): AgentTool<typeof appendSchema> {
  const session = opts.environment;
  const clock = opts.now ?? (() => new Date());
  return {
    name: "notes_append",
    label: "Notes (append)",
    description:
      "Append a note to the run's session-local scratchpad (<cwd>/.oddjob/notes.md). " +
      "Pass a short `key` (groups related entries) and `text` (markdown). " +
      "Use this for plans, intermediate findings, and anything you want to recall after compaction.",
    parameters: appendSchema,
    async execute(
      _id: string,
      params: AppendInput,
      _signal: AbortSignal | undefined,
    ): Promise<AgentToolResult<{ key: string; appendedBytes: number }>> {
      const ts = clock().toISOString();
      const heading = `\n## [${params.key}] ${ts}\n`;
      const body = params.text.endsWith("\n") ? params.text : `${params.text}\n`;
      const block = `${heading}${body}`;
      // Write via session primitives (NOT shell heredoc). Heredoc-based
      // appends are vulnerable to delimiter-collision injection if the
      // agent's text happens to contain the EOF marker on its own line.
      // Read-modify-write is slightly more I/O but eliminates that class.
      const mkdir = await session.exec(`mkdir -p ${shellQuote(NOTES_DIR)}`);
      if (mkdir.exitCode !== 0) {
        return {
          content: [
            {
              type: "text",
              text: `notes_append error: mkdir exit ${mkdir.exitCode}\n${mkdir.stderr ?? ""}`,
            },
          ],
          details: { key: params.key, appendedBytes: 0 },
        };
      }
      let existing = "";
      try {
        existing = await session.readFile(NOTES_FILE);
      } catch {
        // File doesn't exist yet — that's fine.
        existing = "";
      }
      try {
        await session.writeFile(NOTES_FILE, `${existing}${block}`);
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `notes_append error: write failed: ${(err as Error).message}`,
            },
          ],
          details: { key: params.key, appendedBytes: 0 },
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `appended to ${NOTES_FILE} under [${params.key}] (${block.length} bytes)`,
          },
        ],
        details: { key: params.key, appendedBytes: block.length },
      };
    },
  };
}

export function createNotesReadTool(opts: NotesToolOptions): AgentTool<typeof readSchema> {
  const session = opts.environment;
  return {
    name: "notes_read",
    label: "Notes (read)",
    description:
      "Read the session-local scratchpad (<cwd>/.oddjob/notes.md). " +
      "Pass an optional `key` to filter to entries with that key heading.",
    parameters: readSchema,
    async execute(
      _id: string,
      params: ReadInput,
      _signal: AbortSignal | undefined,
    ): Promise<AgentToolResult<{ found: boolean; bytes: number }>> {
      const exists = await session.exec(`test -f ${shellQuote(NOTES_FILE)}`);
      if (exists.exitCode !== 0) {
        return {
          content: [{ type: "text", text: "(notes.md does not exist yet — nothing to read)" }],
          details: { found: false, bytes: 0 },
        };
      }
      let body: string;
      try {
        body = await session.readFile(NOTES_FILE);
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `notes_read error: ${(err as Error).message}`,
            },
          ],
          details: { found: false, bytes: 0 },
        };
      }
      if (params.key) {
        const filtered = filterByKey(body, params.key);
        if (!filtered) {
          return {
            content: [{ type: "text", text: `(no entries with key "${params.key}")` }],
            details: { found: false, bytes: 0 },
          };
        }
        return {
          content: [{ type: "text", text: filtered }],
          details: { found: true, bytes: filtered.length },
        };
      }
      return {
        content: [{ type: "text", text: body }],
        details: { found: true, bytes: body.length },
      };
    },
  };
}

/**
 * Returns the substring of `body` containing all `## [key] ...` blocks
 * whose key matches.
 */
function filterByKey(body: string, key: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let inMatchingBlock = false;
  const headingRe = /^## \[([^\]]+)\]/;
  for (const line of lines) {
    const m = line.match(headingRe);
    if (m) {
      inMatchingBlock = m[1] === key;
    }
    if (inMatchingBlock) out.push(line);
  }
  return out.join("\n").trim();
}
