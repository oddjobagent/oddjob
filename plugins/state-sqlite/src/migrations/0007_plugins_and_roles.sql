-- Phase 16: plugin registry, provider credentials, engine model role assignments,
-- model catalog cache, and per-deployment role overrides.

CREATE TABLE IF NOT EXISTS plugins (
  slug         TEXT PRIMARY KEY,
  version      TEXT NOT NULL,
  source       TEXT NOT NULL,            -- 'bundled' | 'local' | 'npm'
  enabled      INTEGER NOT NULL DEFAULT 1,
  manifest_json TEXT NOT NULL,
  config_json  TEXT,
  installed_at INTEGER NOT NULL,
  disabled_at  INTEGER                    -- soft-delete
);

CREATE TABLE IF NOT EXISTS provider_credentials (
  provider_slug   TEXT NOT NULL,
  credential_name TEXT NOT NULL DEFAULT 'default',
  api_key_secret  TEXT,                   -- secret name in secrets table
  options_json    TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (provider_slug, credential_name)
);

CREATE TABLE IF NOT EXISTS engine_model_roles (
  role             TEXT PRIMARY KEY,      -- 'default' | 'advisor' | 'grader' | <custom>
  provider_slug    TEXT NOT NULL,
  model_id         TEXT NOT NULL,
  credential_name  TEXT NOT NULL DEFAULT 'default',
  options_json     TEXT,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS model_catalog (
  provider_slug TEXT NOT NULL,
  model_id      TEXT NOT NULL,
  data_json     TEXT NOT NULL,
  fetched_at    INTEGER NOT NULL,
  PRIMARY KEY (provider_slug, model_id)
);

ALTER TABLE deployments ADD COLUMN model_role_overrides_json TEXT;
