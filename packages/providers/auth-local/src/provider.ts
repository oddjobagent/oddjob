import type { AuthProvider } from "@oddjob/core";

export class AuthLocalProvider implements Partial<AuthProvider> {
  readonly name = "auth-local";

  async connect(): Promise<void> {
    throw new Error("auth-local: not implemented");
  }

  async disconnect(): Promise<void> {
    return;
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}
