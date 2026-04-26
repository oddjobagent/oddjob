import { describe, expect, test } from "bun:test";
import { ChannelSlackProvider } from "./provider.ts";

describe("ChannelSlackProvider", () => {
  test("requires channelConfig in meta", async () => {
    const p = new ChannelSlackProvider();
    await expect(p.send({ body: "hi", format: "text" })).rejects.toThrow(/channelConfig/);
  });

  test("requires a secret_ref", async () => {
    const p = new ChannelSlackProvider();
    await expect(
      p.send({
        body: "hi",
        format: "text",
        meta: { channelConfig: { type: "slack", target: "#x" } },
      }),
    ).rejects.toThrow(/webhookUrlSecretRef|botTokenSecretRef/);
  });
});
