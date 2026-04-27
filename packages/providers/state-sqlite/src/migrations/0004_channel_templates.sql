-- Phase 15 (deferred): named channel presets reusable across deployments.

CREATE TABLE IF NOT EXISTS channel_templates (
  name         TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  config_json  TEXT NOT NULL,
  description  TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
