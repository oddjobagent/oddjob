-- Phase A.2: durable run-event log for `ctx.*` calls (script-mode replay).
--
-- Events are written `pending` before the side effect; updated to
-- `completed`/`failed` after. Replay sees `pending` row → re-execute;
-- `completed` → return recorded result. Forks record `child_run_id` so
-- the parent can find the in-flight child after restart.
--
-- Replay keying: lookup by (run_id, seq), then assert
-- call_site/call_type/call_args_hash match. Mismatch → fail loud.
--
-- Retention: keep-all. No prune job.

CREATE TABLE IF NOT EXISTS run_events (
  run_id          TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  call_site       TEXT NOT NULL,
  call_type       TEXT NOT NULL CHECK(call_type IN (
    'fork','mcp','tool','sleep','approval','runAgent','notify','now','uuid','random',
    'memory_get','memory_set','scratch_get','scratch_set','waitForRun'
  )),
  call_args_hash  TEXT NOT NULL,
  args_json       TEXT,                                -- canonical args (redacted), null if too large
  status          TEXT NOT NULL CHECK(status IN ('pending','completed','failed')),
  started_at      INTEGER NOT NULL,
  completed_at    INTEGER,
  result_json     TEXT,
  error_json      TEXT,
  child_run_id    TEXT,                                -- set for fork events
  schema_version  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (run_id, seq)
);
CREATE INDEX IF NOT EXISTS run_events_run_id ON run_events(run_id);
CREATE INDEX IF NOT EXISTS run_events_child_run_id ON run_events(child_run_id) WHERE child_run_id IS NOT NULL;
