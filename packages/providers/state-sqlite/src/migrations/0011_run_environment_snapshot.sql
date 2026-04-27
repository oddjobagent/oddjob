-- Phase 15b: snapshot the resolved Environment on each Run for provenance.
--
-- Stores `{ id?, source, serviceId, trustTier }` so historical runs survive
-- later edits to environment records / engine defaults. Nullable for back
-- compat with rows created before this migration.

ALTER TABLE runs ADD COLUMN environment_snapshot_json TEXT;
