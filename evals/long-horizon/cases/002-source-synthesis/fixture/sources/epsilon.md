# epsilon.md — scratchpad notes for long-horizon planning

The `notes_append(key, text)` and `notes_read(key?)` tools back a session-
local file at `<cwd>/.oddjob/notes.md`. The file SURVIVES compaction —
when the conversation gets summarised, the agent can `notes_read` to
rehydrate context that was dropped from the live transcript.

Use cases:
- Multi-stage plan: write the plan to `[plan]` key, then refer back as
  each stage completes.
- Cross-tool findings: log non-obvious results from tool calls so they
  don't get lost in compaction.
- Self-correction: write down what NOT to repeat (mistakes, dead ends).

Notes are an append-only convention. The agent CAN cheat with the `bash`
or `write` tools to overwrite the file directly, which is fine — this
is a coordination convention, not a security boundary.
