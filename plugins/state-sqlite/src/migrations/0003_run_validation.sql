-- Phase 15 (deferred): persist output schema validation result on each run row.

ALTER TABLE runs ADD COLUMN output_validation_json TEXT;
