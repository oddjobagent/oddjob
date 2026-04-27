import { describe, expect, test } from "bun:test";

import {
  composeOutputSchemaWithChannels,
  type DynamicChannelDescriptor,
} from "./output-schema-compose.ts";

const EMAIL_DESC: DynamicChannelDescriptor = {
  name: "email",
  type: "email",
  contract: {
    type: "object",
    properties: { subject: { type: "string" }, body_html: { type: "string" } },
  },
};

describe("composeOutputSchemaWithChannels", () => {
  test("zero channels returns the original schema unchanged", () => {
    const original = {
      type: "json-schema",
      schema: { type: "object", properties: { x: { type: "string" } } },
    } as const;
    expect(composeOutputSchemaWithChannels(original, [])).toBe(original);
  });

  test("one channel + no original schema synthesizes a wrapper", () => {
    const result = composeOutputSchemaWithChannels(undefined, [EMAIL_DESC]);
    expect(result?.type).toBe("json-schema");
    const props = (result?.schema as { properties: Record<string, unknown> }).properties;
    expect(props.channels).toBeDefined();
    expect((props.channels as { properties: Record<string, unknown> }).properties.email).toEqual(
      EMAIL_DESC.contract!,
    );
  });

  test("merges with existing object schema, preserving original properties", () => {
    const original = {
      type: "json-schema" as const,
      schema: {
        type: "object",
        required: ["x"],
        properties: { x: { type: "string" } },
      },
    };
    const result = composeOutputSchemaWithChannels(original, [EMAIL_DESC]);
    const merged = result!.schema as Record<string, unknown>;
    const props = merged.properties as Record<string, unknown>;
    expect(merged.required).toEqual(["x"]);
    expect(props.x).toEqual({ type: "string" });
    expect(props.channels).toBeDefined();
  });

  test("channel without contract gets empty object schema", () => {
    const result = composeOutputSchemaWithChannels(undefined, [
      { name: "console", type: "console" },
    ]);
    const channelsProps = (
      (result!.schema as { properties: { channels: { properties: Record<string, unknown> } } })
        .properties.channels.properties
    );
    expect(channelsProps.console).toEqual({ type: "object" });
  });
});
