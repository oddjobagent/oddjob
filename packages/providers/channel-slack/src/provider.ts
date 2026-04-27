import type {
  ChannelMessage,
  ChannelProvider,
  SlackChannelConfig,
  SecretsProvider,
} from "@oddjob/core";

export interface ChannelSlackOptions {
  secrets?: SecretsProvider;
}

export class ChannelSlackProvider implements ChannelProvider {
  readonly name = "channel-slack";
  readonly outputContract = {
    type: "object",
    description:
      "Agent-fillable Slack fields. Set only when the deployment's slack channel uses mode = 'dynamic'.",
    properties: {
      target: {
        type: "string",
        description: "Channel id or webhook URL. Overrides deploy-time `target`. Use cautiously.",
      },
      text: {
        type: "string",
        description: "Plain text body. Overrides the run's finalText.",
      },
      blocks: {
        type: "array",
        items: { type: "object" },
        description:
          "Slack Block Kit blocks. When set, `text` is the fallback for unformatted clients.",
      },
    },
  } as const;

  private readonly secrets?: SecretsProvider;

  constructor(opts: ChannelSlackOptions = {}) {
    this.secrets = opts.secrets;
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return true;
  }

  async send(message: ChannelMessage): Promise<void> {
    const meta = message.meta as Record<string, unknown> | undefined;
    const cfg = meta?.channelConfig as SlackChannelConfig | undefined;
    if (!cfg || cfg.type !== "slack") throw new Error("channel-slack: missing channelConfig");

    if (cfg.webhookUrlSecretRef) {
      const url = await this.lookup(cfg.webhookUrlSecretRef);
      if (!url) throw new Error(`channel-slack: secret ${cfg.webhookUrlSecretRef} unset`);
      await postSlackWebhook(url, cfg.target, message, meta);
      return;
    }

    if (cfg.botTokenSecretRef) {
      const token = await this.lookup(cfg.botTokenSecretRef);
      if (!token) throw new Error(`channel-slack: secret ${cfg.botTokenSecretRef} unset`);
      await postSlackChat(token, cfg.target, message, meta);
      return;
    }

    throw new Error("channel-slack: webhookUrlSecretRef or botTokenSecretRef required");
  }

  private async lookup(secretRef: string): Promise<string | null> {
    if (this.secrets) {
      const v = await this.secrets.get(secretRef);
      if (v) return v;
    }
    return process.env[secretRef] ?? null;
  }
}

async function postSlackWebhook(
  url: string,
  channel: string,
  message: ChannelMessage,
  meta: Record<string, unknown> | undefined,
): Promise<void> {
  const blocks = buildSlackBlocks(message, meta);
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channel, text: message.body.slice(0, 200), blocks }),
  });
  if (!r.ok) throw new Error(`slack webhook ${r.status}: ${await r.text()}`);
}

async function postSlackChat(
  token: string,
  channel: string,
  message: ChannelMessage,
  meta: Record<string, unknown> | undefined,
): Promise<void> {
  const blocks = buildSlackBlocks(message, meta);
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel, text: message.body.slice(0, 200), blocks }),
  });
  const j = (await r.json()) as { ok: boolean; error?: string };
  if (!j.ok) throw new Error(`slack chat.postMessage failed: ${j.error}`);
}

function buildSlackBlocks(
  message: ChannelMessage,
  meta: Record<string, unknown> | undefined,
): Array<Record<string, unknown>> {
  const runId = meta?.runId as string | undefined;
  const blocks: Array<Record<string, unknown>> = [
    { type: "section", text: { type: "mrkdwn", text: message.body.slice(0, 3000) } },
  ];
  if (meta?.structured) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "```" + JSON.stringify(meta.structured, null, 2).slice(0, 2900) + "```",
      },
    });
  }
  if (runId) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `run \`${runId}\`` }],
    });
  }
  return blocks;
}
