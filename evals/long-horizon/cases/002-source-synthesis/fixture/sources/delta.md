# delta.md — tool-result truncation

Large tool results (long bash logs, big file reads, dense grep hits) blow
the context window AND degrade caching by churning the message list.
Truncating with a structured affordance lets the agent ask for more bytes
only when it actually needs them.

Cap: 8KB per result. On overflow, return the first 4KB plus a marker
naming the original size and a `show_tool_result(toolUseId, byteRange)`
recall mechanism. Persist the full text per `toolUseId` in a per-run
store.

Side benefit: cache hit rate rises because compact context reduces
churn. Pair with B1.6 JIT skill loading (manifest in system prompt, full
bodies on demand via `skill_load`) for compounding savings.
