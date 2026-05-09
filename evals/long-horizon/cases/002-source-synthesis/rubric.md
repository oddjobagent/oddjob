# Rubric — long-horizon/002-source-synthesis

Pass criteria (all must hold):

1. **All 6 source files were read.** The agent's tool trace shows `read` calls
   (or equivalent) for every file in `fixture/sources/` (`alpha.md`,
   `beta.md`, `gamma.md`, `delta.md`, `epsilon.md`, `zeta.md`).
2. **`summary.md` exists at the fixture root** and is non-empty.
3. **`summary.md` mentions every source filename** at least once (case-
   insensitive). The agent should make the synthesis traceable.
4. **`summary.md` is between 8 and 20 paragraphs.** Paragraphs are separated
   by a blank line. Below 8 = under-synthesised; above 20 = the agent
   probably dumped the source content rather than synthesising.
5. **The closing paragraph names a unifying theme or contradiction** across
   the 6 sources. Look for explicit synthesis language ("the common thread
   is", "all six argue that", "the contradiction is", etc.).

Fail if any criterion is missed. The agent's structured output (if any)
is irrelevant — verdict is based on filesystem state + summary content.
