CREATE TABLE IF NOT EXISTS secrets (
  name             TEXT PRIMARY KEY,
  value_encrypted  BLOB NOT NULL,
  iv               BLOB NOT NULL,
  tag              BLOB NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
