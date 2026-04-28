import type { ChannelMessage, ChannelProvider } from "@oddjob/core";

export class ChannelConsoleProvider implements ChannelProvider {
  readonly name = "channel-console";

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return true;
  }

  async send(message: ChannelMessage): Promise<void> {
    const meta = message.meta as Record<string, unknown> | undefined;
    const banner = meta?.runId ? `\n[run ${meta.runId}]` : "";
    process.stdout.write(`${banner}\n${message.body}\n`);
    if (meta?.structured) {
      process.stdout.write(`structured: ${JSON.stringify(meta.structured, null, 2)}\n`);
    }
  }
}
