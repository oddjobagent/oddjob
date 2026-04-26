import type { Provider } from "./base.ts";

export interface SecretsProvider extends Provider {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
  list(): Promise<string[]>;
  has(name: string): Promise<boolean>;
}
