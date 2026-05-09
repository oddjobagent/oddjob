# gamma.md — context-window compaction

When conversation history approaches the model's context window, the run
fails with a hard limit error. Compaction collapses the middle of the
history into a single synthetic summary, preserving the original prompt
and the most recent N turns.

Trigger heuristic: compact when `tokens_in_history >= 0.7 *
contextWindow`. Pin the original user prompt (always) plus the last 4
assistant/tool turns. Use a cheap model (Haiku) for the summarisation —
the summary doesn't need the run's primary model.

Determinism trade-off: the summary loses information. Pre-compaction
history must be persisted to durable storage (`run_messages` table) so
replay and debug can recover what was collapsed. Without persistence,
compacted runs become un-debuggable.
