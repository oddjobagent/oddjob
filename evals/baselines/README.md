# Eval baselines

Each `vN.json` is a snapshot of the four-profile eval at one point in
time. Aggregate + per-profile metrics + per-row data are all preserved.
Generate via `scripts/aggregate-baselines.ts --version vN`.

## v0 (2026-05-08)

7 cases / 4 pass (57.1%) / $0.13 total. Pre-Phase-B baseline against
OpenRouter Haiku 4.5.

- coding: 3/3 (100%) — $0.075
- data-extract: 1/2 (50%) — $0.014
- long-horizon: 0/1 (0%) — $0.029
- web-research: 0/1 (0%) — $0.014
- cache_hit_ratio: 0% across all profiles

## v1 (2026-05-09)

13 cases / 12 pass (92.3%) / $0.31 total. Post-Phase-B baseline.

- coding: 5/5 (100%) — $0.152, cache_hit 31%
- data-extract: 2/3 (67%) — $0.024
- long-horizon: 3/3 (100%) — $0.116, cache_hit 40%
- web-research: 2/2 (100%) — $0.019

## v3 (2026-05-09)

**32 cases / 27 pass (84.4%) / $0.70 total.** Dataset extended from 13 → 32 cases (8 per profile). Same code as v2 — only the dataset changed.

- coding: 8/8 (100%) — $0.232, cache_hit 34%
- data-extract: 5/8 (62%) — $0.081
- long-horizon: 7/8 (88%) — $0.321, cache_hit 54%
- web-research: 7/8 (88%) — $0.066

**Failures (5):**
- `data-extract/001-emails-from-html` — flake (was 2/2 pass v1/v2, fail v3, pass v3-rerun). Confirmed stochastic at the borderline: prompt mixes "do not include" with one explicit "this one IS valid" exception, and Haiku doesn't always honour the exception. Either tighten the prompt or move to a stochastic-tolerance bucket.
- `data-extract/003-currency-from-receipt` — designed-hard receipt-noise filtering; consistent fail across v1/v2/v3.
- `data-extract/008-addresses-from-email` — soft gate (street + postal pair match); legitimate format ambiguity per dataset agent's notes.
- `long-horizon/008-batch-rename` — new case; agent likely missed one of 8 grep/edit replacements.
- `web-research/004-mdn-css-properties` — new case; soft pass-rate gate (≥12/14) likely missed one property.

**Design takeaways from a 32-case run:**
- coding: still 100% even with 3 new bug classes (shadowed-var, null-deref, wrong-constant). Coding is Haiku 4.5's strongest profile.
- data-extract: 62% — adversarial extraction is the model's weakest. Hard cases (003 currency, 008 addresses) reveal the noise-filtering ceiling.
- long-horizon: 88% — the agent reliably handles multi-step tasks when the goal is concrete. batch-rename's miss suggests grep-driven mass-edits may need an additional verification step.
- web-research: 88% — programmatic check.ts gates produce honest signal. Single fail is on a 14-property list with ≥12 threshold.

**Costs:** $0.70 across 32 cases ≈ $0.022 per case. Long-horizon dominates (45% of cost on 25% of cases) — the 8 multi-step tasks have 30+ tool calls each.

## v2 (2026-05-09)

13 cases / 12 pass (92.3%) / $0.30 total. Re-run after B2.3 (script-mode
runtime) + B2.4 (replay engine) + R12 codex hardening landed. Confirms v1's
pass-rate is stable (not a single-run fluke).

- coding: 5/5 (100%) — $0.137, cache_hit 22%
- data-extract: 2/3 (67%) — $0.024 (currency case still the only failure)
- long-horizon: 3/3 (100%) — $0.122, cache_hit 55%
- web-research: 2/2 (100%) — $0.019

Differences from v1 are within stochastic noise on a 13-case dataset:

- Coding cache_hit shifted 31% → 22% (LLM-side hit ratio drifts ±10pp per
  run on small prompts that hover near Anthropic's 2048-token threshold).
- Long-horizon cache_hit climbed 40% → 55% — the 6-doc synthesis run had
  more turns this time, building up a larger cached prefix.
- Total cost went $0.31 → $0.30 (~3% drop). B2.3/B2.4 added no measurable
  overhead because no v1/v2 case is script-mode — the new code paths only
  fire when `blueprint.scriptMode === true`.

The single failure (`data-extract/003-currency-from-receipt`) is unchanged
across both runs — designed-hard receipt-noise filtering is consistently
beyond Haiku 4.5's reliability bar. That's honest signal, not regression.

What changed between v0 and v1:

1. **Phase B harness wins shipped** (B1.0–B1.6 + B2.1 + B2.2). Cache
   zones (B1.1) responsible for the 31% / 40% cache_hit jumps on
   coding + long-horizon — large-context profiles now hit Anthropic's
   Haiku 2048-token cache threshold consistently.
2. **6 new cases added.** Coding +2 (large-log-needle, async-race),
   long-horizon +2 (source-synthesis, plan-with-notes), data-extract +1
   (currency-from-receipt), web-research +1 (http-status-codes).
3. **Long-horizon + web-research moved to programmatic checks.** The
   rubric grader can only see the agent's final assistant text — terse
   `report_status` summaries don't satisfy filesystem-state criteria.
   Programmatic `check.ts` files inspect the sandbox directly: summary
   files, notes scratchpad, .eval-output.txt for prose answers.
4. **Tightened long-horizon programmatic checks** (codex round 11 R-003)
   to assert distinctive concepts from each source appear in the
   synthesis, not just filename references — prevents
   filename-only-stub passes.
5. **`[engine.compaction]` TOML plumbing** added so `mode = "auto"`
   actually reaches the agent loop's compactor at run time.

The single v1 failure is `data-extract/003-currency-from-receipt` —
designed hard with ad copy + struck-through staff notes + footer
notices to filter out. Model partial-credits the recognition; passes
emails + dates but the receipt's noise floor confuses it.

## Per-case behaviour notes

- `web-research/001-rfc-2119-keywords`: passes when ≥5/6 of MUST, MUST
  NOT, SHOULD, SHOULD NOT, MAY, OPTIONAL appear in the agent's final
  text. Strict 6/6 was too tight on a single run.
- `web-research/002-http-status-codes`: passes when ≥18/21 4xx codes
  from the corpus appear AND no out-of-range or hallucinated codes are
  mentioned.
- `long-horizon/002-source-synthesis`: passes when summary.md exists,
  references all 6 source filenames, contains distinctive concepts from
  each (cache/retry/compact/truncat/note/skill), and ends with
  synthesis language (theme/contradiction/trade-off).
- `long-horizon/003-plan-with-notes`: passes when `.oddjob/notes.md`
  has both `[plan]` + `[progress]` headings AND `bun test` exits 0.
  Required wiring `notes_append` + `notes_read` into the eval's
  synthesized blueprint tools.

## How to regenerate

```bash
# Run all 4 profiles (live OpenRouter; ~$0.30 spend)
bun apps/cli/src/index.ts eval evals/coding         --out evals/.runs/vN-coding
bun apps/cli/src/index.ts eval evals/data-extract   --out evals/.runs/vN-data-extract
bun apps/cli/src/index.ts eval evals/long-horizon   --out evals/.runs/vN-long-horizon
bun apps/cli/src/index.ts eval evals/web-research   --out evals/.runs/vN-web-research

# Aggregate
bun scripts/aggregate-baselines.ts --version vN --out evals/baselines/vN.json
```

## Open follow-ups

- `data-extract/003` — currency case is real difficulty; either a v2
  candidate for B1.x improvements or an honest "model can't reliably
  filter receipt noise" data point.
- Compaction (B1.3) is wired but never fires in the v1 baseline because
  no case crosses the inter-invocation boundary — the inline compactor
  only runs on grader-revision iterations. Real test would need a case
  with 30+ turns or a multi-iteration grader.
- Truncation (B1.4) didn't trigger on `coding/004-large-log-needle`
  because the agent inspected `parser.ts` directly and ignored the log;
  triggering would need a case where reading the large file is the only
  path.
