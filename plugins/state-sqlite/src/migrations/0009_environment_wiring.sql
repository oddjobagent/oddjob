-- Phase 15b: Environment wiring on deployments + engine-level default.
--
-- Each deployment optionally pins an Environment record by id, OR carries an
-- inline override JSON (for one-off / fully-inline configs). Resolution
-- cascade: deployment-inline > deployment.environment_id > engine default >
-- hard default. See core/src/plugin/env-resolver.ts.

ALTER TABLE deployments ADD COLUMN environment_id TEXT REFERENCES environments(id);
ALTER TABLE deployments ADD COLUMN environment_inline_json TEXT;

-- Engine-level singleton settings keyed by string. First user is
-- `default_environment_id`. Future: `default_egress_proxy_url`, etc.
CREATE TABLE IF NOT EXISTS engine_settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
