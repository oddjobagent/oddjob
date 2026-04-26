import { Database } from "bun:sqlite";

import type { SecretsProvider } from "@oddjob/core";

import { runMigrations } from "./migrate.ts";
import { open, seal } from "./vault.ts";

export interface SqliteSecretsOptions {
  path: string;
  masterKey: Buffer;
}

export class SecretsSqliteProvider implements SecretsProvider {
  readonly name = "secrets-sqlite";
  private db!: Database;
  private readonly path: string;
  private readonly masterKey: Buffer;

  constructor(options: SqliteSecretsOptions) {
    this.path = options.path;
    this.masterKey = options.masterKey;
  }

  async connect(): Promise<void> {
    this.db = new Database(this.path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    await runMigrations(this.db);
  }

  async disconnect(): Promise<void> {
    this.db?.close();
  }

  async healthy(): Promise<boolean> {
    try {
      this.db.query("SELECT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  async get(name: string): Promise<string | null> {
    const row = this.db
      .query<{ value_encrypted: Uint8Array; iv: Uint8Array; tag: Uint8Array }, [string]>(
        "SELECT value_encrypted, iv, tag FROM secrets WHERE name = ?",
      )
      .get(name);
    if (!row) return null;
    return open(
      {
        ciphertext: Buffer.from(row.value_encrypted),
        iv: Buffer.from(row.iv),
        tag: Buffer.from(row.tag),
      },
      this.masterKey,
      { aad: name },
    );
  }

  async set(name: string, value: string): Promise<void> {
    const sealed = seal(value, this.masterKey, { aad: name });
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO secrets (name, value_encrypted, iv, tag, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           value_encrypted = excluded.value_encrypted,
           iv = excluded.iv,
           tag = excluded.tag,
           updated_at = excluded.updated_at`,
      )
      .run(name, sealed.ciphertext, sealed.iv, sealed.tag, now, now);
  }

  async delete(name: string): Promise<void> {
    this.db.query("DELETE FROM secrets WHERE name = ?").run(name);
  }

  async list(): Promise<string[]> {
    const rows = this.db
      .query<{ name: string }, []>("SELECT name FROM secrets ORDER BY name")
      .all();
    return rows.map((r) => r.name);
  }

  async has(name: string): Promise<boolean> {
    const row = this.db
      .query<{ n: number }, [string]>("SELECT 1 as n FROM secrets WHERE name = ?")
      .get(name);
    return Boolean(row);
  }
}
