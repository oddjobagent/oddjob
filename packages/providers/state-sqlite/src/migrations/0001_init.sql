-- Initial Oddjob state schema (oddjob.db)

CREATE TABLE IF NOT EXISTS blueprints (
  id              TEXT PRIMARY KEY,            -- namespace/name
  name            TEXT NOT NULL,
  namespace       TEXT NOT NULL,
  version         TEXT NOT NULL,
  schema_version  INTEGER NOT NULL DEFAULT 1,
  description     TEXT NOT NULL,
  config_toml     TEXT NOT NULL,               -- raw blueprint.toml source
  config_json     TEXT NOT NULL,               -- normalized Blueprint JSON
  content_hash    TEXT NOT NULL,
  source_path     TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS blueprints_namespace_idx ON blueprints(namespace);

CREATE TABLE IF NOT EXISTS deployments (
  id              TEXT PRIMARY KEY,            -- UUID
  name            TEXT NOT NULL UNIQUE,
  blueprint_id    TEXT NOT NULL REFERENCES blueprints(id),
  triggers_json   TEXT NOT NULL,
  channels_json   TEXT NOT NULL,
  limits_json     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS deployments_blueprint_idx ON deployments(blueprint_id);
CREATE INDEX IF NOT EXISTS deployments_status_idx ON deployments(status);

CREATE TABLE IF NOT EXISTS runs (
  id              TEXT PRIMARY KEY,
  deployment_id   TEXT NOT NULL REFERENCES deployments(id),
  blueprint_id    TEXT NOT NULL REFERENCES blueprints(id),
  blueprint_hash  TEXT NOT NULL,               -- contentHash at run time
  triggered_by    TEXT NOT NULL,
  status          TEXT NOT NULL,
  input_json      TEXT,
  output_json     TEXT,
  error           TEXT,
  cost_usd        REAL,
  token_input     INTEGER NOT NULL DEFAULT 0,
  token_output    INTEGER NOT NULL DEFAULT 0,
  tool_calls      INTEGER NOT NULL DEFAULT 0,
  started_at      INTEGER,
  finished_at     INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_deployment_idx ON runs(deployment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS runs_status_idx ON runs(status);

CREATE TABLE IF NOT EXISTS memory (
  deployment_id   TEXT NOT NULL,
  namespace       TEXT NOT NULL,
  key             TEXT NOT NULL,
  value_json      TEXT NOT NULL,
  expires_at      INTEGER,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (deployment_id, namespace, key)
);
CREATE INDEX IF NOT EXISTS memory_expires_idx ON memory(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS connector_tokens (
  connector_id            TEXT PRIMARY KEY,    -- deployment_id:connector_name
  deployment_id           TEXT NOT NULL,
  connector_name          TEXT NOT NULL,
  access_token_encrypted  BLOB NOT NULL,
  refresh_token_encrypted BLOB,
  expires_at              INTEGER,
  refresh_expires_at      INTEGER,
  token_url               TEXT,
  client_id               TEXT,
  client_secret_encrypted BLOB,
  scopes                  TEXT,
  status                  TEXT NOT NULL DEFAULT 'active',
  updated_at              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS connector_tokens_deployment_idx ON connector_tokens(deployment_id);
