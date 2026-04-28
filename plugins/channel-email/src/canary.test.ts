import { describe, expect, test } from "bun:test";
import { ChannelEmailProvider } from "./provider.ts";

describe("ChannelEmailProvider", () => {
  test("requires channelConfig", async () => {
    const p = new ChannelEmailProvider();
    await expect(p.send({ body: "hi", format: "text" })).rejects.toThrow(/channelConfig/);
  });
  test("smtp path requires the smtp_url secret to be set", async () => {
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
    ).rejects.toThrow(/SMTP_URL/);
  });
  test("rejects when neither smtp nor resend is configured", async () => {
    const p = new ChannelEmailProvider();
    await expect(
      p.send({
        body: "hi",
        format: "text",
        meta: {
          channelConfig: {
            type: "email",
            to: "x@y.com",
          },
        },
      }),
    ).rejects.toThrow(/smtp_url_secret_ref or resend_api_key_secret_ref/);
  });
});
