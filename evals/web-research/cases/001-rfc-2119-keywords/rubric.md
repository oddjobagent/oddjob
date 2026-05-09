# Rubric — 001-rfc-2119-keywords

The agent's final answer passes if and only if it lists exactly these six
keywords (RFC 2119 §1–5):

- MUST
- MUST NOT
- SHOULD
- SHOULD NOT
- MAY
- (note: the sixth top-level definition in the question is the count of
  imperatives the RFC defines as primary keywords. Treat the six as the
  five above plus exactly one of the synonyms `REQUIRED` / `SHALL` /
  `RECOMMENDED` / `OPTIONAL` — the agent may have miscounted but listing
  the five canonical ones plus any synonym is acceptable.)

## Pass criteria (grader checks all)

1. Final answer contains a list (any format — bullet, numbered, prose
   enumeration) of MUST, MUST NOT, SHOULD, SHOULD NOT, MAY.
2. Final answer contains a sixth term that is one of: REQUIRED, SHALL,
   SHALL NOT, RECOMMENDED, NOT RECOMMENDED, OPTIONAL.
3. No extras outside the RFC 2119 keyword set (e.g. listing "WILL" or
   "MIGHT" fails the case).
4. Order does not matter.

## Fail examples

- Lists only 5 keywords.
- Includes a non-keyword like "WILL".
- Lists capitalized synonyms as if they were distinct primary keywords AND
  omits one of the five canonical ones.
