import type { Provider } from "./base.ts";

export interface StorageProvider extends Provider {
  write(key: string, data: Uint8Array | string, meta?: Record<string, string>): Promise<string>;
  read(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  exists(key: string): Promise<boolean>;
}
