# beta.md — retry semantics for streaming LLM calls

Retrying a failed LLM call is only safe BEFORE any tool has fired. Once a
tool has executed, side effects may have landed (file writes, MCP
mutations, channel deliveries) — re-running the turn would double-execute
them. Best practice: track a `toolsFiredInTurn` flag in `beforeToolCall`
and short-circuit retry once it flips.

Retryable error classes: 429 (rate limit), 502/503/504 (gateway noise),
529 (Anthropic overload), `ECONNRESET`, `ETIMEDOUT`. Non-retryable: 400
(bad request), 401 (auth), 422 (validation).

Backoff: exponential with jitter. Base 500ms, cap 8000ms, jitter 30%.
Three tries is usually enough for transient noise; circuit-break after
3 consecutive same-error fails for 60s.
