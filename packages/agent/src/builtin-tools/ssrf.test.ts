import { describe, expect, test } from "bun:test";
import { assertSafeUrl, SsrfBlockedError } from "./ssrf.ts";

describe("assertSafeUrl", () => {
  test("rejects non-http(s) protocol", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow(SsrfBlockedError);
  });

  test("rejects loopback hostname", async () => {
    await expect(assertSafeUrl("http://localhost:8080")).rejects.toThrow(SsrfBlockedError);
  });

  test("rejects 127.0.0.1 literal", async () => {
    await expect(assertSafeUrl("http://127.0.0.1/admin")).rejects.toThrow(SsrfBlockedError);
  });

  test("rejects 10.0.0.0/8", async () => {
    await expect(assertSafeUrl("http://10.5.5.5/")).rejects.toThrow(/private/);
  });

  test("rejects 192.168.0.0/16", async () => {
    await expect(assertSafeUrl("http://192.168.1.1/")).rejects.toThrow(/private/);
  });

  test("rejects link-local 169.254.0.0/16", async () => {
    await expect(assertSafeUrl("http://169.254.169.254/")).rejects.toThrow(/private/);
  });

  test("rejects IPv6 loopback ::1", async () => {
    await expect(assertSafeUrl("http://[::1]/")).rejects.toThrow(/private/);
  });

  test("accepts public IPv4 literal", async () => {
    const url = await assertSafeUrl("https://1.1.1.1/");
    expect(url.hostname).toBe("1.1.1.1");
  });

  test("allows private IPs when override is set", async () => {
    const url = await assertSafeUrl("http://127.0.0.1/", { privateIpsAllowed: true });
    expect(url.hostname).toBe("127.0.0.1");
  });

  test("blocklist by exact hostname", async () => {
    await expect(
      assertSafeUrl("https://example.com/", { blocklist: ["example.com"] }),
    ).rejects.toThrow(/blocklisted/);
  });

  test("blocklist with wildcard", async () => {
    await expect(
      assertSafeUrl("https://api.example.com/", { blocklist: ["*.example.com"] }),
    ).rejects.toThrow(/blocklisted/);
  });

  test("allowlist rejects non-listed hosts", async () => {
    await expect(
      assertSafeUrl("https://other.com/", { allowlist: ["example.com"] }),
    ).rejects.toThrow(/allowlist/);
  });
});
