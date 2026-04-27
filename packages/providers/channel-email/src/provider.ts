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
  readonly outputContract = {
    type: "object",
    description:
      "Agent-fillable email fields. Only set when the deployment's email channel uses mode = 'dynamic'. Omit any field to fall back to the deploy-time default.",
    properties: {
      to: {
        type: "array",
        items: { type: "string", format: "email" },
        description: "Recipient address(es). Overrides deploy-time `to`.",
      },
      subject: {
        type: "string",
        maxLength: 200,
        description: "Email subject line. Overrides deploy-time `subject`.",
      },
      body_text: {
        type: "string",
        description: "Plain text body. Overrides the run's finalText.",
      },
      body_html: {
        type: "string",
        description:
          "HTML body. When set, body_text MUST also be set as a fallback for clients that don't render HTML.",
      },
    },
  } as const;

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

    if (cfg.smtpUrlSecretRef) {
      await this.sendViaSmtp(cfg, message);
      return;
    }
    if (cfg.resendApiKeySecretRef) {
      await this.sendViaResend(cfg, message);
      return;
    }
    throw new Error("channel-email: configure smtp_url_secret_ref or resend_api_key_secret_ref");
  }

  private async sendViaSmtp(cfg: EmailChannelConfig, message: ChannelMessage): Promise<void> {
    const url = await this.lookup(cfg.smtpUrlSecretRef!);
    if (!url) throw new Error(`channel-email: secret ${cfg.smtpUrlSecretRef} unset`);
    // Lazy-import nodemailer so the dependency is only loaded when SMTP is used.
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport(url);
    await transport.sendMail({
      from: cfg.from ?? "oddjob@localhost",
      to: cfg.to,
      subject: cfg.subject ?? message.subject ?? "Oddjob run output",
      text: message.body,
    });
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
        subject: cfg.subject ?? message.subject ?? "Oddjob run output",
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
