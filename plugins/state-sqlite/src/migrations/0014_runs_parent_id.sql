-- Phase A.2: parent/child run linkage for `ctx.fork` (B2.3) + cost rollup.
--
-- Nullable. Top-level runs have parent_run_id = NULL. Forked child runs
-- record their parent here; `runs.costUsd` aggregator walks the chain.

ALTER TABLE runs ADD COLUMN parent_run_id TEXT REFERENCES runs(id);
CREATE INDEX IF NOT EXISTS runs_parent_run_id ON runs(parent_run_id) WHERE parent_run_id IS NOT NULL;
