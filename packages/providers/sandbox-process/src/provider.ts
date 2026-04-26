import type { SandboxProvider } from "@oddjob/core";

export class SandboxProcessProvider implements Partial<SandboxProvider> {
  readonly name = "sandbox-process";

  async connect(): Promise<void> {
    throw new Error("sandbox-process: not implemented");
  }

  async disconnect(): Promise<void> {
    return;
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}
