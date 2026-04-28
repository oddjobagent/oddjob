-- §B: Docker-style blueprint versioning + tags.
-- Each push stores an immutable (id, version) row. Tags are movable pointers.
-- Deployments resolve to a tag (default "latest"). Runs snapshot the resolved version.

CREATE TABLE IF NOT EXISTS blueprint_versions (
  blueprint_id  TEXT NOT NULL,
  version       TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  description   TEXT NOT NULL,
  config_toml   TEXT NOT NULL,
  config_json   TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  source_path   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (blueprint_id, version)
);
CREATE INDEX IF NOT EXISTS blueprint_versions_id_idx ON blueprint_versions(blueprint_id, created_at DESC);

CREATE TABLE IF NOT EXISTS blueprint_tags (
  blueprint_id  TEXT NOT NULL,
  tag           TEXT NOT NULL,
  version       TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (blueprint_id, tag),
  FOREIGN KEY (blueprint_id, version) REFERENCES blueprint_versions(blueprint_id, version)
);
CREATE INDEX IF NOT EXISTS blueprint_tags_id_idx ON blueprint_tags(blueprint_id);

ALTER TABLE deployments ADD COLUMN blueprint_tag TEXT NOT NULL DEFAULT 'latest';

ALTER TABLE runs ADD COLUMN blueprint_version TEXT;

-- Backfill: copy each existing blueprints row into blueprint_versions and point latest at it.
INSERT INTO blueprint_versions (blueprint_id, version, schema_version, description,
                                config_toml, config_json, content_hash, source_path, created_at)
SELECT id, version, schema_version, description,
       config_toml, config_json, content_hash, source_path, created_at
FROM blueprints
WHERE NOT EXISTS (
  SELECT 1 FROM blueprint_versions bv
  WHERE bv.blueprint_id = blueprints.id AND bv.version = blueprints.version
);

INSERT INTO blueprint_tags (blueprint_id, tag, version, updated_at)
SELECT id, 'latest', version, updated_at FROM blueprints
WHERE NOT EXISTS (
  SELECT 1 FROM blueprint_tags bt
  WHERE bt.blueprint_id = blueprints.id AND bt.tag = 'latest'
);

-- Backfill run.blueprint_version with the run's blueprint_hash if it matches a version's content_hash;
-- otherwise leave NULL (older runs predate the resolved-version snapshot).
UPDATE runs SET blueprint_version = (
  SELECT version FROM blueprint_versions bv
  WHERE bv.blueprint_id = runs.blueprint_id AND bv.content_hash = runs.blueprint_hash
  LIMIT 1
) WHERE blueprint_version IS NULL;
