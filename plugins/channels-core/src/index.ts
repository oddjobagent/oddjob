// @oddjob/plugin-channels-core — bundles the four core channel providers
// (console, slack, email, webhook) as ChannelService entries.

import { ChannelConsoleProvider } from "@oddjob/channel-console";
import { ChannelEmailProvider } from "@oddjob/channel-email";
import { ChannelSlackProvider } from "@oddjob/channel-slack";
import { ChannelWebhookProvider } from "@oddjob/channel-webhook";

import { definePlugin } from "@oddjob/sdk";

export default definePlugin(
  {
    slug: "channels-core",
    name: "Core Channels",
    description: "Console, Slack, Email (Resend), and Webhook channel providers.",
    version: "0.1.0",
    author: "Oddjob",
  },
  (b) => {
    b.channel({
      type: "console",
      displayName: "Console",
      create: () => new ChannelConsoleProvider(),
    });
    b.channel({
      type: "slack",
      displayName: "Slack",
      create: (ctx) => new ChannelSlackProvider({ secrets: ctx.secrets }),
    });
    b.channel({
      type: "email",
      displayName: "Email",
      create: (ctx) => new ChannelEmailProvider({ secrets: ctx.secrets }),
    });
    b.channel({
      type: "webhook",
      displayName: "Webhook",
      create: (ctx) => new ChannelWebhookProvider({ secrets: ctx.secrets }),
    });
  },
);
