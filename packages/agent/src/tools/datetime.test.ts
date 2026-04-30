import { describe, expect, test } from "bun:test";
import { createDatetimeTool } from "./datetime.ts";

const FIXED = new Date("2026-04-26T17:30:45Z");

describe("createDatetimeTool", () => {
  test("default returns ISO 8601 in UTC", async () => {
    const tool = createDatetimeTool({ now: () => FIXED });
    const r = await tool.execute("c1", {}, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toBe("2026-04-26T17:30:45.000Z");
    expect(r.details.timezone).toBe("UTC");
    expect(r.details.unix).toBe(Math.floor(FIXED.getTime() / 1000));
  });

  test("unix format", async () => {
    const tool = createDatetimeTool({ now: () => FIXED });
    const r = await tool.execute("c2", { format: "unix" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toBe(String(Math.floor(FIXED.getTime() / 1000)));
  });

  test("rfc2822 format", async () => {
    const tool = createDatetimeTool({ now: () => FIXED });
    const r = await tool.execute("c3", { format: "rfc2822" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toMatch(/Sun, 26 Apr 2026/);
  });

  test("timezone shifts ISO output", async () => {
    const tool = createDatetimeTool({ now: () => FIXED });
    const r = await tool.execute("c4", { timezone: "America/Los_Angeles" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("America/Los_Angeles");
    expect(text).toContain("2026-04-26T10:30:45");
  });

  test("invalid timezone returns helpful error", async () => {
    const tool = createDatetimeTool({ now: () => FIXED });
    const r = await tool.execute("c5", { timezone: "Mars/Olympus" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("invalid timezone");
  });
});
