# web-research

Multi-source synthesis from cached web corpora. Measures the loop's ability
to fetch, read, and synthesize across documents.

## Dimension

Information retrieval + synthesis. Each case has a question and a
`fixture/corpus/` of cached HTML snapshots. The agent's `web_fetch` is
rewired in eval mode to resolve URLs against this corpus — never live HTTP.

## Grading — rubric (trend signal, not a hard gate)

`runGrader` reads the case `rubric.md` and the agent's final output, then
emits a 0/1 verdict. Grader pinned in `evals/grader.json`. Rubric writing
is a craft — pass criteria must be unambiguous (exact lists, exact phrases)
to keep the grader stable.

## Cases

Hand-authored. Eight planned across:

1. single-source factual lookup — case 001 (RFC 2119 keywords, this commit)
2. multi-source agreement
3. multi-source contradiction (which is right?)
4. not-in-corpus (must report unknown)
   5–8. TODO

## Target metrics

- pass-rate: TBD (capture v0)
- $/run: < $0.10 (agent + grader combined)
- mean turns: < 8

## Holdout

3 cases reserved from tuning iterations once authored. `holdout.json` empty
for now.

## Why fixture corpora

Live HTTP makes scores flaky (page changes, captchas, geo, rate limits) and
non-reproducible across machines. Cached HTML keeps the eval deterministic.
The cost is curation — corpora must be refreshed deliberately when the spec
changes.
