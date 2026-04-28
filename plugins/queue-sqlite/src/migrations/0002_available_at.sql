ALTER TABLE queued_runs ADD COLUMN available_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS queued_runs_available_idx ON queued_runs(status, available_at);
