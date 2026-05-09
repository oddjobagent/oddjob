# Rubric — long-horizon/003-plan-with-notes

Multi-stage refactor task. The agent must:

1. **Write a plan to the scratchpad** using `notes_append({key: "plan", text: ...})` BEFORE making any code changes.
2. **Execute each plan stage**, reading the plan back via `notes_read({key: "plan"})` as needed.
3. **Apply changes correctly** so the test suite passes.
4. **Log progress entries** under a `progress` key (one `notes_append` per completed stage) so a future debug pass can see what was done.

Pass criteria:
- `<cwd>/.oddjob/notes.md` exists.
- That file contains a `## [plan]` heading with substantive content (not "TODO", not blank).
- That file contains at least 2 `## [progress]` headings (one per completed stage; this task has 3 stages so 2+ is reasonable for a partial-progress run).
- Running `bun test` in the fixture exits 0.

Fail if:
- notes.md is missing.
- The agent only used the bash/write tools (no `notes_append` evidence).
- Tests still fail.
