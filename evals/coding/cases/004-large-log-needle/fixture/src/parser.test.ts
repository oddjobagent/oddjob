import { expect, test } from "bun:test";
import { parseConfigLine } from "./parser.ts";

test("parses simple key:value", () => {
  expect(parseConfigLine("host:localhost")).toEqual({ key: "host", value: "localhost" });
});

test("preserves colons in the value (URLs etc)", () => {
  expect(parseConfigLine("server:http://example.com:8080/path")).toEqual({
    key: "server",
    value: "http://example.com:8080/path",
  });
});

test("handles missing value", () => {
  expect(parseConfigLine("orphan:")).toEqual({ key: "orphan", value: "" });
});
