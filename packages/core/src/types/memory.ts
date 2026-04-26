export interface MemoryEntry {
  deploymentId: string;
  key: string;
  value: unknown;
  expiresAt?: number;
  updatedAt: number;
}
