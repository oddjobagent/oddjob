import type { ChannelProvider } from "@oddjob/core";

export class ChannelSlackProvider implements Partial<ChannelProvider> {
  readonly name = "channel-slack";

  async connect(): Promise<void> {
    throw new Error("channel-slack: not implemented");
  }

  async disconnect(): Promise<void> {
    return;
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}
