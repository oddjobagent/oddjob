-- Phase 17: hybrid TOML+DB config. Add provenance to engine config rows so the
-- dashboard can label them "managed by config.toml" and reconciliation knows
-- which rows it owns vs which originated from the dashboard.

ALTER TABLE provider_credentials ADD COLUMN source TEXT NOT NULL DEFAULT 'dashboard';
ALTER TABLE engine_model_roles ADD COLUMN source TEXT NOT NULL DEFAULT 'dashboard';
