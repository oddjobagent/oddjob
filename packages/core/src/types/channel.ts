export type ChannelConfig =
  | ConsoleChannelConfig
  | SlackChannelConfig
  | EmailChannelConfig
  | WebhookChannelConfig;

export interface ConsoleChannelConfig {
  type: "console";
}

export interface SlackChannelConfig {
  type: "slack";
  target: string;
  webhookUrlSecretRef?: string;
  botTokenSecretRef?: string;
}

export interface EmailChannelConfig {
  type: "email";
  to: string | string[];
  from?: string;
  smtpUrlSecretRef?: string;
  resendApiKeySecretRef?: string;
}

export interface WebhookChannelConfig {
  type: "webhook";
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
