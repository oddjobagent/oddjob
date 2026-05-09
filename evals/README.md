# Oddjob evals

Datasets for measuring agent loop quality. Phase A.5 of the consolidation plan.

The eval harness (`oddjob eval`, Phase A.3) reads `dataset.jsonl`, runs the
agent against each case in an isolated sandbox, then either runs the case's
`check.ts` (programmatic) or `runGrader` against `rubric.md` (rubric).

## Profiles

Four profiles, eight cases each (32 total when fully authored). Each measures
a distinct dimension of loop quality:

| Profile         | What it measures                                       | Grading                                    | Hard ship-gate? |
| --------------- | ------------------------------------------------------ | ------------------------------------------ | --------------- |
| `coding/`       | fix-failing-test in a real Bun TS project              | programmatic via `check.ts`                | yes             |
| `web-research/` | multi-source synthesis from cached web corpora         | rubric via `runGrader`                     | no — trend only |
| `data-extract/` | messy text/HTML to strict typebox schema               | programmatic deep-equal vs `expected.json` | yes             |
| `long-horizon/` | 20+ turn synthetic tasks needing planning + scratchpad | rubric + token-budget                      | no — trend only |

## Eval-isolation rule (codex #6)

The agent sandbox sees ONLY the case `fixture/` directory. The harness:

- Copies `fixture/` into a fresh tempdir per case.
- Hides `check.ts`, `expected.json`, `rubric.md`, `dataset.jsonl`, and prior
  baseline outputs from the agent's filesystem and tool-output paths.
- Flags any run whose tool outputs (`grep`/`find`/`ls`/`read`) reveal those
  paths — that is leakage and the case is invalidated.

`check.ts` itself runs OUTSIDE the sandbox, after the agent finishes, with
read access to the post-run fixture tempdir.

## Programmatic vs rubric gating (codex #5)

- **Programmatic suites** (`coding`, `data-extract`) are hard ship-gates.
  Pass-rate regression blocks merge. `check.ts` runs deterministically:
  exit-zero asserts, deep-equal on parsed JSON, file-content matches.
- **Rubric suites** (`web-research`, `long-horizon`) are TREND signal only.
  They run a pinned grader (see `grader.json`) and never block CI. Use them
  to catch regressions early but treat numbers as fuzzy.

The grader model + version + temperature are pinned in `grader.json` so
rubric scores are comparable across runs. Bumping the grader is a
deliberate baseline-reset event.

## Hidden holdout posture

Each rubric profile reserves ~3 cases as `holdout.json`. These cases:

- Are NOT included in iteration tuning. Tuning the loop against them
  contaminates the evaluation.
- Get evaluated only at phase-exit gates (e.g. A.8, B1 exit, B2 exit) to
  detect overfit to the visible cases.

`holdout.json` ships with `{"reserved": []}` until cases are authored.

## Web-research = fixture corpora, never live HTTP

Web-research cases include a `fixture/corpus/` directory of cached HTML
snapshots. The agent's `web_fetch` is rewired in eval mode to resolve URLs
against this corpus. Live HTTP would make scores flaky and non-reproducible.

## Layout

```
evals/
  README.md              this file
  grader.json            pinned grader config (rubric profiles)
  baselines/             v0.json from A.8 — committed history of metrics
  .runs/                 per-eval sqlite + reports — gitignored
  <profile>/
    README.md            target metrics + dimension
    dataset.jsonl        one line per case
    holdout.json         {"reserved": [<case-id>...]}
    cases/<id>/
      fixture/           agent-visible input
      check.ts           programmatic verifier (coding, data-extract)
      expected.json      reference output (data-extract)
      rubric.md          pass criteria (web-research, long-horizon)
```

See per-profile README for target metrics + scoring shape.
