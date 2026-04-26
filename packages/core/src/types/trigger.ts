export type Trigger = CronTrigger | WebhookTrigger | ManualTrigger | EventTrigger;

export interface CronTrigger {
  type: "cron";
  schedule: string;
  timezone?: string;
}

export interface WebhookTrigger {
  type: "webhook";
  path?: string;
  auth: WebhookAuth;
}

export type WebhookAuth =
  | { kind: "none" }
  | { kind: "bearer"; secretRef: string }
  | { kind: "hmac"; algorithm: "sha256"; secretRef: string; header: string };

export interface ManualTrigger {
  type: "manual";
}

export interface EventTrigger {
  type: "event";
  source: string;
  filter?: string;
}
