-- Phase 15: deployment extras (model override + default input + archived status)

ALTER TABLE deployments ADD COLUMN model_override TEXT;
ALTER TABLE deployments ADD COLUMN default_input_json TEXT;
