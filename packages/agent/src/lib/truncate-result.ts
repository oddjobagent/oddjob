/**
 * Tool-result truncation. Caps individual tool result text blocks at
 * MAX_RESULT_BYTES; the overflow is stashed in a per-run store keyed by the
 * agent's toolUseId, retrievable via the `show_tool_result` internal tool.
 *
 * Why: large tool outputs (long bash logs, huge file reads, dense grep hits)
 * blow the context window AND degrade caching by churning the message list.
 * Capping with a structured affordance lets the agent ask for more bytes only
 * when it actually needs them.
 */

import { type Static, Type } from "typebox";
import type { TSchema } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

export const MAX_RESULT_BYTES = 8192;
export const TRUNCATE_HEAD_BYTES = 4096;

export interface TruncateStore {
  /** Stash the full text under `toolUseId`. Only called on truncation. */
  set(toolUseId: string, fullText: string): void;
  /** Read back the full text. Returns undefined if not stashed. */
  get(toolUseId: string): { fullText: string; totalBytes: number } | undefined;
  /** Diagnostic: how many entries are stored. */
  size(): number;
}

export function makeTruncateStore(): TruncateStore {
  const map = new Map<string, { fullText: string; totalBytes: number }>();
  return {
    set(id, text) {
      map.set(id, { fullText: text, totalBytes: Buffer.byteLength(text, "utf8") });
    },
    get(id) {
      return map.get(id);
    },
    size() {
      return map.size;
    },
  };
}

/**
 * Wrap a tool so its `text` content blocks get truncated past `maxBytes`. The
 * full text is stashed in `store` keyed by toolUseId so the agent can fetch
 * the rest via `show_tool_result`.
 *
 * Non-text blocks (e.g. images) are left alone.
 */
export function withResultTruncation<S extends TSchema, D>(
  inner: AgentTool<S, D>,
  store: TruncateStore,
  maxBytes: number = MAX_RESULT_BYTES,
): AgentTool<S, D> {
  return {
    ...inner,
    async execute(
      id: string,
      args: Static<S>,
      signal: AbortSignal | undefined,
    ): Promise<AgentToolResult<D>> {
      const r = await inner.execute(id, args, signal);
      let didTruncate = false;
      const newContent = r.content.map((block) => {
        if (block.type !== "text" || typeof block.text !== "string") return block;
        const text = block.text;
        const bytes = Buffer.byteLength(text, "utf8");
        if (bytes <= maxBytes) return block;
        if (!didTruncate) {
          // Only stash the first oversized block per result. Tools rarely
          // emit multiple text blocks; when they do, the additional ones are
          // mirror dumps that aren't worth a separate retrieval key.
          store.set(id, text);
          didTruncate = true;
        }
        const headBuf = Buffer.from(text, "utf8").subarray(0, TRUNCATE_HEAD_BYTES);
        const head = headBuf.toString("utf8");
        return {
          ...block,
          text:
            `${head}\n\n[truncated — tool result was ${bytes} bytes; first ${TRUNCATE_HEAD_BYTES} bytes shown. ` +
            `Call show_tool_result({ toolUseId: "${id}", byteRange: [START, END] }) to read more.]`,
        };
      });
      if (!didTruncate) return r;
      return { ...r, content: newContent };
    },
  };
}

const showToolResultSchema = Type.Object({
  toolUseId: Type.String({
    description:
      "The toolUseId from the truncation marker in a previous tool result. Each call records its own id.",
    minLength: 1,
  }),
  byteRange: Type.Optional(
    Type.Array(Type.Number({ minimum: 0 }), {
      minItems: 2,
      maxItems: 2,
      description:
        "[start, end] byte range to read. Both inclusive of start, exclusive of end. Omit to read from byte TRUNCATE_HEAD_BYTES (4096) to end (i.e. the part you didn't already see).",
    }),
  ),
});

export function createShowToolResultTool(store: TruncateStore): AgentTool<typeof showToolResultSchema> {
  return {
    name: "show_tool_result",
    label: "show_tool_result",
    description:
      "Read more of a previously-truncated tool result. The harness truncates large tool outputs to 8KB; this tool returns additional bytes from the stored full result. Pass the toolUseId that appeared in the truncation marker.",
    parameters: showToolResultSchema,
    async execute(_id, args) {
      const entry = store.get(args.toolUseId);
      if (!entry) {
        return {
          content: [
            {
              type: "text",
              text: `ERROR: no stored result for toolUseId "${args.toolUseId}". Either it was never truncated, or it belongs to a different run. Truncated tool results carry a marker like \`Call show_tool_result({ toolUseId: "..." })\` — copy that exact id.`,
            },
          ],
          details: { error: "not_found", toolUseId: args.toolUseId },
        };
      }
      const fullBuf = Buffer.from(entry.fullText, "utf8");
      const total = fullBuf.length;
      let start = TRUNCATE_HEAD_BYTES;
      let end = total;
      if (args.byteRange) {
        start = Math.min(args.byteRange[0] ?? 0, total);
        end = Math.min(args.byteRange[1] ?? total, total);
      }
      if (start >= end) {
        return {
          content: [
            {
              type: "text",
              text: `ERROR: byteRange [${start}, ${end}) is empty (total=${total}).`,
            },
          ],
          details: { error: "empty_range", start, end, total },
        };
      }
      const slice = fullBuf.subarray(start, end).toString("utf8");
      const remaining = total - end;
      const tail =
        remaining > 0
          ? `\n\n[showing bytes ${start}-${end} of ${total}; ${remaining} bytes remain]`
          : `\n\n[showing bytes ${start}-${end} of ${total}; end of content]`;
      return {
        content: [{ type: "text", text: slice + tail }],
        details: { start, end, total, remaining },
      };
    },
  };
}

export type ShowToolResultSchema = typeof showToolResultSchema;
