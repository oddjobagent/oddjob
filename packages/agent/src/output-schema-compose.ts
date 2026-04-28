import type { BlueprintOutputSchema } from "@oddjob/core";

export interface DynamicChannelDescriptor {
  /** Channel name as it will appear under `channels.<name>` (e.g. "email"). */
  name: string;
  /** Human-readable type id (matches ChannelConfig.type). */
  type: string;
  /** Provider-supplied JSON Schema fragment describing agent-fillable fields. */
  contract?: Record<string, unknown>;
}

/**
 * When ≥1 dynamic channel exists, wrap the blueprint's output_schema with a
 * top-level `channels: { <name>: <contract> }` property. Channels for which
 * the provider didn't declare a contract get an empty `{ type: "object" }`
 * (still routed; just no fields the agent must fill).
 *
 * Returns `original` unchanged when `channels` is empty.
 */
export function composeOutputSchemaWithChannels(
  original: BlueprintOutputSchema | undefined,
  channels: readonly DynamicChannelDescriptor[],
): BlueprintOutputSchema | undefined {
  if (channels.length === 0) return original;

  const channelProps: Record<string, unknown> = {};
  for (const ch of channels) {
    channelProps[ch.name] = ch.contract ?? { type: "object" };
  }
  const channelsBlock: Record<string, unknown> = {
    type: "object",
    description:
      "Per-channel delivery overrides. Fill the entries for channels you want to customize per-run; omitted channels fall back to deploy-time defaults.",
    properties: channelProps,
  };

  if (!original) {
    return {
      type: "json-schema",
      schema: {
        type: "object",
        properties: { channels: channelsBlock },
      },
    };
  }

  const baseSchema = original.schema as Record<string, unknown>;
  const baseProps = (baseSchema.properties as Record<string, unknown> | undefined) ?? {};
  const merged: Record<string, unknown> = {
    ...baseSchema,
    properties: { ...baseProps, channels: channelsBlock },
  };
  return { type: "json-schema", schema: merged };
}
