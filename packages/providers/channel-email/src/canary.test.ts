import { describe, expect, test } from "bun:test";
import { ChannelEmailProvider } from "./provider.ts";

describe("ChannelEmailProvider", () => {
  test("requires channelConfig", async () => {
    const p = new ChannelEmailProvider();
    await expect(p.send({ body: "hi", format: "text" })).rejects.toThrow(/channelConfig/);
  });
  test("rejects when only smtp configured (v1)", async () => {
    const p = new ChannelEmailProvider();
    await expect(
      p.send({
        body: "hi",
        format: "text",
        meta: {
          channelConfig: {
            type: "email",
            to: "x@y.com",
            smtpUrlSecretRef: "SMTP_URL",
          },
        },
      }),
    ).rejects.toThrow(/Resend/);
  });
});
