# alpha — caching strategies for LLM agents

Prefix caching cuts repeat-prompt cost by 70%+ when the system prompt is
stable across turns. Anthropic's `cache_control` marker makes a block
cacheable for ~5 minutes. The cache is keyed on the exact byte content of
the cached prefix — any change invalidates downstream blocks.

The most effective layout is three zones: stable (preamble + tool schemas),
semi-stable (dynamic skill bodies), volatile (user input + scratchpad).
