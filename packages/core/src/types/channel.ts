export type ChannelConfig =
  | ConsoleChannelConfig
  | SlackChannelConfig
  | EmailChannelConfig
  | WebhookChannelConfig;

/**
 * `static` (default): channel reads its config fields verbatim (with `{{input.X}}`
 * template resolution). Phase 14k behavior — preserved.
 *
 * `dynamic`: harness composes the channel's `outputContract` into the run's
 * output_schema, the agent fills `output.structured.channels.<name>`, and
 * dispatch reads from there (falling back to deploy-time fields when the
 * agent omits them). Phase 14L.
 */
export type ChannelMode = "static" | "dynamic";

export interface ConsoleChannelConfig {
  type: "console";
  mode?: ChannelMode;
}

export interface SlackChannelConfig {
  type: "slack";
  mode?: ChannelMode;
  target: string;
  webhookUrlSecretRef?: string;
  botTokenSecretRef?: string;
}

export interface EmailChannelConfig {
  type: "email";
  mode?: ChannelMode;
  /**
   * Recipient address(es). Supports template tokens — e.g. `{{input.email}}`
   * resolves to the run's input field at delivery time. Same scope as
   * `from` / `subject`.
   */
  to: string | string[];
  from?: string;
  subject?: string;
  smtpUrlSecretRef?: string;
  resendApiKeySecretRef?: string;
}

export interface WebhookChannelConfig {
  type: "webhook";
  mode?: ChannelMode;
  url: string;
  hmacSecretRef?: string;
  headers?: Record<string, string>;
}

export interface ChannelMessage {
  to?: string;
  subject?: string;
  body: string;
  format: "text" | "markdown" | "html";
  attachments?: ChannelAttachment[];
  priority?: "low" | "normal" | "high";
  meta?: Record<string, unknown>;
}

export interface ChannelAttachment {
  filename: string;
  contentType: string;
  data: Uint8Array;
}

export interface IncomingMessage {
  channel: string;
  from: string;
  body: string;
  meta?: Record<string, unknown>;
}
