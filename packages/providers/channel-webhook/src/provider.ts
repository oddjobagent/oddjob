import type { ChannelProvider } from "@oddjob/core";

export class ChannelWebhookProvider implements Partial<ChannelProvider> {
  readonly name = "channel-webhook";

  async connect(): Promise<void> {
    throw new Error("channel-webhook: not implemented");
  }

  async disconnect(): Promise<void> {
    return;
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}
