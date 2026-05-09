# coding

Fix-failing-test in a fixture Bun TS project. Measures the loop's ability to
read code, locate a bug, edit, and verify with `bash`/`bun test`.

## Dimension

Localized debugging. Each case is a small self-contained project with one
deliberate bug. The agent has read/write/edit/grep/find/ls/bash. A failing
`bun test` is the entry signal; an exit-zero `bun test` is the success signal.

## Grading — programmatic (hard gate)

`check.ts` runs `bun test` in the post-run fixture and asserts exit 0. No
rubric. No grader cost. Deterministic.

## Cases

Hand-authored. Eight bug types planned:

1. type error (`string` passed where `number` expected) — case 001 (this commit)
2. missing import
3. off-by-one in loop bound
4. shadowed variable
5. null deref
6. async race
7. wrong constant
8. missing branch

Cases 002-008 are TODO.

## Target metrics (Phase A.8 baseline)

- pass-rate: TBD (capture v0)
- p50 wall-clock: < 60s/case
- mean tool-calls: < 15/case
- $/success: < $0.05/case at Haiku-cost grader (programmatic = no grader)

Holdout: none (programmatic — overfit risk lower than rubric).
