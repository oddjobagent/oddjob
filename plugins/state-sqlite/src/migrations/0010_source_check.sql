-- Phase 17: enforce `source` column domain at the DB layer. SQLite cannot
-- ALTER TABLE ADD CONSTRAINT, so we recreate the two affected tables with a
-- CHECK clause and copy data through. Invalid pre-existing values are coerced
-- to 'dashboard' (the safer default; row-mappers used to do the same silently).

CREATE TABLE provider_credentials_new (
  provider_slug   TEXT NOT NULL,
  credential_name TEXT NOT NULL DEFAULT 'default',
  api_key_secret  TEXT,
  options_json    TEXT,
  source          TEXT NOT NULL DEFAULT 'dashboard'
                  CHECK (source IN ('config', 'dashboard')),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (provider_slug, credential_name)
);

INSERT INTO provider_credentials_new
  (provider_slug, credential_name, api_key_secret, options_json, source, created_at, updated_at)
SELECT provider_slug, credential_name, api_key_secret, options_json,
       CASE WHEN source IN ('config','dashboard') THEN source ELSE 'dashboard' END,
       created_at, updated_at
FROM provider_credentials;

DROP TABLE provider_credentials;
ALTER TABLE provider_credentials_new RENAME TO provider_credentials;

CREATE TABLE engine_model_roles_new (
  role            TEXT PRIMARY KEY,
  provider_slug   TEXT NOT NULL,
  model_id        TEXT NOT NULL,
  credential_name TEXT NOT NULL DEFAULT 'default',
  options_json    TEXT,
  source          TEXT NOT NULL DEFAULT 'dashboard'
                  CHECK (source IN ('config', 'dashboard')),
  updated_at      INTEGER NOT NULL
);

INSERT INTO engine_model_roles_new
  (role, provider_slug, model_id, credential_name, options_json, source, updated_at)
SELECT role, provider_slug, model_id, credential_name, options_json,
       CASE WHEN source IN ('config','dashboard') THEN source ELSE 'dashboard' END,
       updated_at
FROM engine_model_roles;

DROP TABLE engine_model_roles;
ALTER TABLE engine_model_roles_new RENAME TO engine_model_roles;
