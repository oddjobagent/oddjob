-- Phase A.2: per-run message log. Used by compaction (B1.3) and replay (B2.4).
--
-- Pre-compaction history is persisted here so a `<compacted>` synthetic
-- message can be reversed for replay / debugging.

CREATE TABLE IF NOT EXISTS run_messages (
  run_id          TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  role            TEXT NOT NULL,        -- user | assistant | tool | compacted
  content_json    TEXT NOT NULL,
  recorded_at     INTEGER NOT NULL,
  schema_version  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (run_id, seq)
);
CREATE INDEX IF NOT EXISTS run_messages_run_id ON run_messages(run_id);
