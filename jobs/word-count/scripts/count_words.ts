#!/usr/bin/env bun
const input = await Bun.stdin.text();
const parsed = JSON.parse(input || "{}") as { text?: string };
const text = parsed.text ?? "";
const count = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
process.stdout.write(JSON.stringify({ count }));
