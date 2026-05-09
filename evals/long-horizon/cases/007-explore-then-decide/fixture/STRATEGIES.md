# Caching strategies

Three options. Pick ONE based on `config.json`. Document your choice in
`decision.md` (a new file you create at the project root). Then
implement it in `src/cache.ts` so the tests in `src/cache.test.ts`
pass.

## Strategy A — write-through

Every write hits both the cache and the backing store. Reads check the
cache first. Pros: strong consistency, simple. Cons: every write incurs
the backing-store cost.

## Strategy B — read-through with TTL

Reads populate the cache lazily on miss. Entries expire after `ttl_ms`.
Pros: lightweight on writes; great for read-heavy workloads with hot
keys. Cons: stale data possible up to `ttl_ms`.

## Strategy C — write-back

Writes go to cache only; flushed to backing store asynchronously. Pros:
fastest writes. Cons: data loss on cache failure; complex flush logic.

## Decision rubric

For this workload (read-heavy, eventual consistency OK, hot keys
dominate, low p99 budget), one of these is clearly best. Your
`decision.md` should:

1. Name the chosen strategy ("Strategy A", "Strategy B", or "Strategy C").
2. Cite at least two facts from `config.json` that support the choice.
3. Briefly note why the other two are wrong here.

The test file at `src/cache.test.ts` will check the implementation
matches the chosen strategy's contract.
