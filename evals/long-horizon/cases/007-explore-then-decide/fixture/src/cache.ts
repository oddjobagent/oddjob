// Implement me. See src/cache.test.ts and STRATEGIES.md.
// The chosen strategy must match the workload in config.json.

export interface CacheOptions {
  ttlMs: number;
  loader: (key: string) => Promise<string>;
  now?: () => number; // injectable clock for testing
}

export class Cache {
  constructor(_opts: CacheOptions) {
    throw new Error("not implemented: Cache");
  }
  async get(_key: string): Promise<string> {
    throw new Error("not implemented: get");
  }
  size(): number {
    throw new Error("not implemented: size");
  }
}
