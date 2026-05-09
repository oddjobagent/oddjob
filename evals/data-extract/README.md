# data-extract

Messy text/HTML to strict typebox schema. Measures structured-output fidelity.

## Dimension

Schema-conforming extraction from noisy input. Each case has an `input.html`
or `input.txt` with hidden expected values, an output schema (typebox), and
an `expected.json` ground truth.

## Grading — programmatic (hard gate)

`check.ts`:

1. Parses agent's structured output.
2. Schema-validates against the case's typebox schema.
3. `Bun.deepEquals` against `expected.json`.

Both must pass. Order-insensitive comparisons (e.g. set-equality on email
arrays) are explicit in `check.ts`.

## Cases

Hand-authored. Eight planned across data shapes:

1. emails from noisy HTML — case 001 (this commit)
2. dates (ISO + natural language)
3. currency amounts with locale
4. academic citations
5. postal addresses
6. semver version strings
7. URLs (incl. relative + protocol-less)
8. structured table rows

## Target metrics

- pass-rate: TBD (capture v0)
- p50 wall-clock: < 30s/case
- $/success: < $0.02/case

Holdout: none (programmatic).
