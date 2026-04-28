CREATE TABLE IF NOT EXISTS run_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL,
  level       TEXT NOT NULL,
  message     TEXT NOT NULL,
  meta_json   TEXT,
  timestamp   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS run_logs_run_idx ON run_logs(run_id, timestamp);
