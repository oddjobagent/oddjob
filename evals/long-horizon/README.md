# long-horizon

20+ turn synthetic tasks. Multi-step planning, intermediate file artifacts,
verification. Measures the loop's behaviour when context pressure is real.

## Dimension

Sustained task completion across many turns. These cases routinely cross
the compaction wall (B1.3) and the token-truncation wall (B1.4). They also
measure scratchpad utility (B1.5) and JIT skill loading (B1.6).

## Grading — rubric + token budget (trend signal)

`runGrader` reads `rubric.md` and the run's final state (output + relevant
files in fixture). Plus a token-budget metric from the step trace — runs
that exceed the budget are flagged even if they pass the rubric.

## Cases

Hand-authored. Eight planned:

1. plan -> execute -> verify a 3-source summary — case 001 (this commit)
2. write + run + refactor a small module
3. multi-doc synthesis to a single file
4. scratchpad-required (info doesn't fit in context)
   5–8. TODO

## Target metrics

- pass-rate: TBD (capture v0)
- p50 turns: < 25
- $/success: < $0.50/case (this is the expensive profile)
- token-budget: < 200K total tokens in/out per run

## Holdout

3 cases reserved from tuning iterations once authored.

## Why this profile exists

The other three profiles are short-horizon. Loop changes that help short
runs (cache-prefix, retry) can hurt long runs (compaction churn,
notes-tool overhead). Long-horizon catches those regressions.
