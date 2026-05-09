CREATE TABLE IF NOT EXISTS run_steps (
  step_id          TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL,
  parent_step_id   TEXT,
  iteration        INTEGER NOT NULL,
  kind             TEXT NOT NULL,
  started_at       INTEGER NOT NULL,
  ended_at         INTEGER,
  tokens_in        INTEGER,
  tokens_out       INTEGER,
  cache_read       INTEGER,
  cache_write      INTEGER,
  cost_usd         REAL,
  model            TEXT,
  tool_name        TEXT,
  tool_args_hash   TEXT,
  tool_result_size INTEGER,
  error            TEXT,
  meta_json        TEXT
);
CREATE INDEX IF NOT EXISTS run_steps_run_idx ON run_steps(run_id, started_at);
CREATE INDEX IF NOT EXISTS run_steps_kind_idx ON run_steps(run_id, kind);
