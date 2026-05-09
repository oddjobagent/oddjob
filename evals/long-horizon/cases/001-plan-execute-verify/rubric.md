# Rubric — 001-plan-execute-verify

The agent task: read three source files in `sources/`, write a combined
summary to `summary.md`, then read it back and confirm structure.

## Pass criteria (grader checks all)

1. A file at `summary.md` exists in the post-run fixture.
2. `summary.md` has exactly 4 paragraphs (paragraphs separated by a blank
   line). Three source paragraphs + one synthesis paragraph.
3. Each of the three source filenames (`alpha.md`, `beta.md`, `gamma.md`)
   appears at least once in `summary.md` (any context — heading, inline
   citation, prose mention).
4. The agent's final tool/turn output explicitly confirms the verification
   step ran (i.e. it read summary.md back and stated the paragraph count
   and filename presence). A plan-then-write run that skips the verify
   step fails the case.

## Fail examples

- summary.md is missing or empty.
- summary.md has 3 paragraphs (no synthesis) or 5+ (over-elaborated).
- One source filename is missing from summary.md.
- Agent wrote summary.md but never read it back to verify.

## Token budget (advisory, not pass/fail)

- target total tokens (in+out across the run): under 50K
- runs over 200K total are flagged as inefficient regardless of pass/fail
