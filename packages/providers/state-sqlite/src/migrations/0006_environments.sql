-- §C: First-class Environment resource (CMA-style cloud container template).
-- Today the local `process` SandboxProvider largely ignores most fields,
-- but blueprints opt into them so cloud SandboxProviders (Phase 15:
-- E2B / Modal / Daytona) can pre-bake images.

CREATE TABLE IF NOT EXISTS environments (
  id           TEXT PRIMARY KEY,
  name         TEXT,
  description  TEXT,
  config_json  TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
