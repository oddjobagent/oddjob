import type {
  ChannelMessage,
  ChannelProvider,
  EmailChannelConfig,
  SecretsProvider,
} from "@oddjob/core";

export interface ChannelEmailOptions {
  secrets?: SecretsProvider;
}

export class ChannelEmailProvider implements ChannelProvider {
  readonly name = "channel-email";
  private readonly secrets?: SecretsProvider;

  constructor(opts: ChannelEmailOptions = {}) {
    this.secrets = opts.secrets;
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return true;
  }

  async send(message: ChannelMessage): Promise<void> {
    const meta = message.meta as Record<string, unknown> | undefined;
    const cfg = meta?.channelConfig as EmailChannelConfig | undefined;
    if (!cfg || cfg.type !== "email") throw new Error("channel-email: missing channelConfig");

    if (cfg.resendApiKeySecretRef) {
      await this.sendViaResend(cfg, message);
      return;
    }
    throw new Error(
      "channel-email: only Resend is supported in v1 (set resend_api_key_secret_ref). SMTP support TBD.",
    );
  }

  private async sendViaResend(cfg: EmailChannelConfig, message: ChannelMessage): Promise<void> {
    const apiKey = await this.lookup(cfg.resendApiKeySecretRef!);
    if (!apiKey) throw new Error(`channel-email: secret ${cfg.resendApiKeySecretRef} unset`);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: cfg.from ?? "Oddjob <oddjob@resend.dev>",
        to: cfg.to,
        subject: message.subject ?? "Oddjob run output",
        text: message.body,
      }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  }

  private async lookup(secretRef: string): Promise<string | null> {
    if (this.secrets) {
      const v = await this.secrets.get(secretRef);
      if (v) return v;
    }
    return process.env[secretRef] ?? null;
  }
}
