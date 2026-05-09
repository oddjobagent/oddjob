// Tool-call dedup (Phase 3.3 of agent_core_eval). Caches the result of a
// previous identical (toolName + canonicalJsonHash(args)) call within a
// single run so the agent doesn't re-pay for redundant reads.
//
// **Allowlist-only.** Only side-effect-free reads are dedup-eligible.
// Mutating tools (bash/write/edit/python/javascript/MCP/web_*/task) are
// never cached and ALSO clear the cache when they fire — a bash exec
// can mutate any path that future read/grep/find/ls might touch, so any
// cached "read X = ..." is potentially stale after a bash call.
// (codex round-20 #4)
//
// **Truncation order.** Compose `withDedup(withResultTruncation(tool))`
// — dedup is OUTER, truncation INNER — so the cache stores the
// already-truncated user-visible result. On a dedup hit, we re-store
// the overflow under the new toolUseId so `show_tool_result` works on
// the deduped call too. (codex round-20 #1, #2)

import { createHash } from "node:crypto";

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Static, TSchema } from "typebox";

import { canonicalJsonStringify } from "./canonical-json.ts";
import type { TruncateStore } from "./truncate-result.ts";

/**
 * Tools whose results are deterministic given the run's environment +
 * filesystem state. The dedup cache invalidates on every other tool
 * call so "filesystem state" is "the snapshot just before this read."
 */
export const DEDUP_ALLOWLIST: ReadonlySet<string> = new Set([
  "read",
  "grep",
  "find",
  "ls",
]);

export interface DedupCacheEntry {
  /** The cached tool result (already truncated if applicable). */
  result: AgentToolResult<unknown>;
  /** The original tool_use_id that generated this result. Surfaced in dedup hits. */
  originalToolUseId: string;
  /** The original step_id (for trace cross-reference + meta.dedupOf). */
  originalStepId?: string;
  /**
   * Snapshot of the truncate-store entry produced by the original call,
   * if any. On a dedup hit we re-stash this under the new toolUseId so
   * `show_tool_result` works.
   */
  overflowText?: string;
}

export interface DedupCache {
  /**
   * Look up a prior result. Returns undefined if no prior call OR if
   * the cache was cleared by an intervening mutating tool.
   */
  get(toolName: string, argsHash: string): DedupCacheEntry | undefined;
  /** Cache a successful tool result. No-op for non-allowlisted tools. */
  set(toolName: string, argsHash: string, entry: DedupCacheEntry): void;
  /**
   * Clear the entire cache. Called after any non-allowlisted tool call
   * (mutation potential) and after any dedup-allowlisted tool error.
   */
  clear(): void;
  /** Diagnostic. */
  size(): number;
}

export function makeDedupCache(): DedupCache {
  const map = new Map<string, DedupCacheEntry>();
  return {
    get(toolName, argsHash) {
      if (!DEDUP_ALLOWLIST.has(toolName)) return undefined;
      return map.get(`${toolName}|${argsHash}`);
    },
    set(toolName, argsHash, entry) {
      if (!DEDUP_ALLOWLIST.has(toolName)) return;
      map.set(`${toolName}|${argsHash}`, entry);
    },
    clear() {
      map.clear();
    },
    size() {
      return map.size;
    },
  };
}

/** sha256(canonicalJson(args)) — same hash style as run_events. */
export function hashToolArgs(args: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(args)).digest("hex");
}

/**
 * Wrap a dedup-allowlisted tool. Composition: this should be the OUTER
 * wrapper, with `withResultTruncation` inner — so we cache the already-
 * truncated user-visible content. (codex round-20 #1)
 */
export interface DedupHitInfo {
  toolName: string;
  toolUseId: string;
  originalToolUseId: string;
  originalStepId?: string;
}

export interface DedupWrapOptions {
  cache: DedupCache;
  truncateStore?: TruncateStore | undefined;
  /**
   * Look up the step_id for THIS tool_use_id. Recorded in
   * `beforeToolCall`. Used to populate `originalStepId` on cache write
   * so dedup hits can reference the actual originating step row.
   * Mapping by id (not a shared mutable) because pi-agent-core
   * dispatches tools in parallel — a single "current step id"
   * variable points to the latest beforeToolCall, not the executing
   * call's step. (codex round-23 R-003)
   */
  stepIdForToolUseId?: (toolUseId: string) => string | undefined;
  /** Called on each dedup hit so the loop can attach metadata to the closing tool_call step row. */
  recordHit?: (info: DedupHitInfo) => void;
}

export function withDedup<S extends TSchema, D>(
  inner: AgentTool<S, D>,
  opts: DedupWrapOptions,
): AgentTool<S, D> {
  if (!DEDUP_ALLOWLIST.has(inner.name)) return inner;
  const { cache, truncateStore, stepIdForToolUseId, recordHit } = opts;
  return {
    ...inner,
    async execute(
      id: string,
      args: Static<S>,
      signal: AbortSignal | undefined,
    ): Promise<AgentToolResult<D>> {
      const argsHash = hashToolArgs(args);
      const hit = cache.get(inner.name, argsHash);
      if (hit) {
        recordHit?.({
          toolName: inner.name,
          toolUseId: id,
          originalToolUseId: hit.originalToolUseId,
          ...(hit.originalStepId ? { originalStepId: hit.originalStepId } : {}),
        });
        // Re-stash overflow under new toolUseId so show_tool_result
        // works on the deduped call. (codex round-20 #2)
        if (hit.overflowText && truncateStore) {
          truncateStore.set(id, hit.overflowText);
        }
        return prependDedupMarker(hit.result, hit.originalToolUseId) as AgentToolResult<D>;
      }
      const result = await inner.execute(id, args, signal);
      // Only cache successful results — error responses might be
      // transient (filesystem race, abort) and shouldn't poison.
      if (looksLikeError(result)) return result;
      const entry: DedupCacheEntry = {
        result,
        originalToolUseId: id,
        ...(stepIdForToolUseId?.(id) ? { originalStepId: stepIdForToolUseId(id)! } : {}),
        ...(truncateStore?.get(id) ? { overflowText: truncateStore.get(id)?.fullText } : {}),
      };
      cache.set(inner.name, argsHash, entry);
      return result;
    },
  };
}

/** Heuristic: does the result look like an error we shouldn't cache? */
function looksLikeError(r: AgentToolResult<unknown>): boolean {
  const block = r.content[0];
  if (!block || block.type !== "text" || typeof block.text !== "string") return false;
  const head = block.text.slice(0, 64);
  return /^(ERROR\b|\[error\]|\[task error\])/i.test(head);
}

/**
 * Determine whether a tool name is mutation-capable and should
 * invalidate the dedup cache before its turn dispatches. Anything not
 * in `DEDUP_ALLOWLIST` is treated as potentially mutating — bash,
 * python, javascript, write, edit, MCP, web_*, task, and any
 * plugin-contributed tool. (codex round-20 #4)
 *
 * Caller is `beforeToolCall` so cache clears BEFORE pi-agent-core's
 * parallel batch dispatch starts. (codex round-23 R-002)
 */
export function shouldInvalidateCacheFor(toolName: string): boolean {
  return !DEDUP_ALLOWLIST.has(toolName);
}

/**
 * Prepend a "[duplicate call]" marker to the first text block of a
 * cached result so the agent knows it's looking at recycled output.
 */
function prependDedupMarker(
  r: AgentToolResult<unknown>,
  originalToolUseId: string,
): AgentToolResult<unknown> {
  const marker =
    `[duplicate call — returning prior result; original tool_use_id="${originalToolUseId}"]\n\n`;
  const newContent = r.content.map((block, idx) => {
    if (idx === 0 && block.type === "text" && typeof block.text === "string") {
      return { ...block, text: marker + block.text };
    }
    return block;
  });
  return { ...r, content: newContent };
}
