# gamma — context-window compaction

When agent history approaches the context-window limit, summarize the
middle of the conversation into a synthetic message and keep the head
(original prompt) and tail (last few turns) intact. The pinned head
preserves task framing; the pinned tail preserves recent tool results
the next turn likely depends on.

The summary itself should be terse — bullet points of decisions made and
key facts learned, not a narrative recap.
