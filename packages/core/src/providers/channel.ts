import type { ChannelMessage, IncomingMessage } from "../types/channel.ts";
import type { Provider } from "./base.ts";

export interface ChannelProvider extends Provider {
  send(message: ChannelMessage): Promise<void>;
  onReceive?(handler: (msg: IncomingMessage) => Promise<void>): void;
  /**
   * Optional JSON Schema fragment describing the agent-fillable fields the
   * channel will read from `output.structured.channels.<name>` when the
   * deployment's channel config sets `mode = "dynamic"`. All declared fields
   * should be optional so the harness can fall back to deploy-time defaults.
   */
  readonly outputContract?: Record<string, unknown>;
}
