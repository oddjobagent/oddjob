import type { ChannelMessage, IncomingMessage } from "../types/channel.ts";
import type { Provider } from "./base.ts";

export interface ChannelProvider extends Provider {
  send(message: ChannelMessage): Promise<void>;
  onReceive?(handler: (msg: IncomingMessage) => Promise<void>): void;
}
