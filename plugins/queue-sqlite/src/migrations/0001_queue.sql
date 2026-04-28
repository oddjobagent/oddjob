-- Run queue (queue.db)

CREATE TABLE IF NOT EXISTS queued_runs (
  run_id          TEXT PRIMARY KEY,
  config_json     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued',  -- queued | running | failed
  attempts        INTEGER NOT NULL DEFAULT 0,
  worker_id       TEXT,
  leased_until    INTEGER,
  last_error      TEXT,
  enqueued_at     INTEGER NOT NULL,
  started_at      INTEGER,
  finished_at     INTEGER
);
CREATE INDEX IF NOT EXISTS queued_runs_status_idx ON queued_runs(status, enqueued_at);
CREATE INDEX IF NOT EXISTS queued_runs_lease_idx  ON queued_runs(status, leased_until);

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id       TEXT PRIMARY KEY,
  last_beat_at    INTEGER NOT NULL,
  pid             INTEGER,
  hostname        TEXT
);
