import type { ChannelProvider } from "@oddjob/core";

export class ChannelEmailProvider implements Partial<ChannelProvider> {
  readonly name = "channel-email";

  async connect(): Promise<void> {
    throw new Error("channel-email: not implemented");
  }

  async disconnect(): Promise<void> {
    return;
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}
