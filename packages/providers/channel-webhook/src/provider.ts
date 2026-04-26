import { createHmac } from "node:crypto";

import type {
  ChannelMessage,
  ChannelProvider,
  SecretsProvider,
  WebhookChannelConfig,
} from "@oddjob/core";

export interface ChannelWebhookOptions {
  secrets?: SecretsProvider;
}

export class ChannelWebhookProvider implements ChannelProvider {
  readonly name = "channel-webhook";
  private readonly secrets?: SecretsProvider;

  constructor(opts: ChannelWebhookOptions = {}) {
    this.secrets = opts.secrets;
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return true;
  }

  async send(message: ChannelMessage): Promise<void> {
    const meta = message.meta as Record<string, unknown> | undefined;
    const cfg = meta?.channelConfig as WebhookChannelConfig | undefined;
    if (!cfg || cfg.type !== "webhook") throw new Error("channel-webhook: missing channelConfig");

    const payload = {
      run_id: meta?.runId,
      deployment_id: meta?.deploymentId,
      blueprint_id: meta?.blueprintId,
      body: message.body,
      structured: meta?.structured,
    };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...cfg.headers,
    };
    if (cfg.hmacSecretRef) {
      const secret = await this.lookup(cfg.hmacSecretRef);
      if (secret) {
        headers["x-oddjob-signature"] = createHmac("sha256", secret).update(body).digest("hex");
      }
    }
    const r = await fetch(cfg.url, { method: "POST", headers, body });
    if (!r.ok) throw new Error(`webhook ${r.status}: ${await r.text()}`);
  }

  private async lookup(secretRef: string): Promise<string | null> {
    if (this.secrets) {
      const v = await this.secrets.get(secretRef);
      if (v) return v;
    }
    return process.env[secretRef] ?? null;
  }
}
