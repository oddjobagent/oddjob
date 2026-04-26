import type { SecretsProvider } from "@oddjob/core";

export class SecretsSqliteProvider implements Partial<SecretsProvider> {
  readonly name = "secrets-sqlite";

  async connect(): Promise<void> {
    throw new Error("secrets-sqlite: not implemented");
  }

  async disconnect(): Promise<void> {
    return;
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}
