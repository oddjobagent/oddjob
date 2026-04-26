import type { ChannelProvider } from "@oddjob/core";

export class ChannelConsoleProvider implements Partial<ChannelProvider> {
  readonly name = "channel-console";

  async connect(): Promise<void> {
    throw new Error("channel-console: not implemented");
  }

  async disconnect(): Promise<void> {
    return;
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}
