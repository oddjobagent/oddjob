import type { StorageProvider } from "@oddjob/core";

export class StorageLocalProvider implements Partial<StorageProvider> {
  readonly name = "storage-local";

  async connect(): Promise<void> {
    throw new Error("storage-local: not implemented");
  }

  async disconnect(): Promise<void> {
    return;
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}
