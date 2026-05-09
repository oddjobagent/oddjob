# alpha.md — caching strategies

Prompt caching is most effective when the cached prefix is large and stable
across many requests. Anthropic's `cache_control` markers create up to four
breakpoints; the longest contiguous prefix matching a marker becomes the
cached region. Cost savings are highest when the cached region is system
prompt + tool definitions (which rarely change) and the volatile region is
just the per-request input.

Common pitfalls:
- Embedding per-request data into the system prompt invalidates the cache
  on every call.
- Tool definitions appearing in different orders across calls also
  invalidate.
- Tiny cached regions (< 1024 tokens for Sonnet, ~2048 for Haiku) don't
  trigger cache writes at all.

Best-practice layout: stable preamble (>2K tokens) → semi-stable skill
descriptions → volatile per-call user input.
