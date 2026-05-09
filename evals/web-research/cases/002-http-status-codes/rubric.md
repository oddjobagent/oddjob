# Rubric — web-research/002-http-status-codes

The agent has a cached copy of MDN's "HTTP response status codes" page at
`corpus/mdn-status-codes.html`. The task: list every 4xx (client error)
status code defined on that page, with a one-line description for each.

Pass criteria:
- The final answer lists at least 12 distinct 4xx status codes.
- Each entry has BOTH the numeric code AND a description.
- Codes outside the 4xx range (1xx, 2xx, 3xx, 5xx) MUST NOT appear.
- The list is grounded in the corpus — codes that don't appear in
  `corpus/mdn-status-codes.html` count as hallucinations and fail the
  case.

The agent is expected to use `read` (or `bash cat`) on the corpus file.
A `web_fetch` call against an external URL is allowed but not required;
if the agent does fetch externally, the corpus copy is still the source
of truth — we're testing extraction, not network search.

Fail if:
- The list omits more than 5 of the 4xx codes that ARE in the corpus.
- Codes appear that aren't in the corpus (hallucination).
- Non-4xx codes appear.
