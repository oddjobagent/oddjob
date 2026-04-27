import { describe, expect, test } from "bun:test";

import { formatBlueprintRef, parseBlueprintRef } from "./blueprint.ts";

describe("parseBlueprintRef", () => {
  test("bare id leaves tag/version unset (caller defaults to 'latest')", () => {
    expect(parseBlueprintRef("ns/name")).toEqual({ id: "ns/name" });
  });

  test("id with :tag", () => {
    expect(parseBlueprintRef("ns/name:stable")).toEqual({ id: "ns/name", tag: "stable" });
  });

  test("id with @version", () => {
    expect(parseBlueprintRef("ns/name@0.1.0")).toEqual({ id: "ns/name", version: "0.1.0" });
  });

  test("trims surrounding whitespace", () => {
    expect(parseBlueprintRef("  ns/name:latest  ")).toEqual({ id: "ns/name", tag: "latest" });
  });

  test("rejects missing namespace", () => {
    expect(() => parseBlueprintRef("name")).toThrow(/invalid blueprint ref/);
  });

  test("rejects upper-case in id", () => {
    expect(() => parseBlueprintRef("Ns/name")).toThrow(/invalid/);
  });

  test("rejects empty tag/version", () => {
    expect(() => parseBlueprintRef("ns/name:")).toThrow(/invalid/);
    expect(() => parseBlueprintRef("ns/name@")).toThrow(/invalid/);
  });

  test("accepts dotted+pre-release version", () => {
    expect(parseBlueprintRef("ns/name@1.2.3-alpha.4")).toEqual({
      id: "ns/name",
      version: "1.2.3-alpha.4",
    });
  });
});

describe("formatBlueprintRef", () => {
  test("bare id when no tag/version", () => {
    expect(formatBlueprintRef({ id: "ns/name" })).toBe("ns/name");
  });

  test("omits :latest", () => {
    expect(formatBlueprintRef({ id: "ns/name", tag: "latest" })).toBe("ns/name");
  });

  test("renders custom tag", () => {
    expect(formatBlueprintRef({ id: "ns/name", tag: "stable" })).toBe("ns/name:stable");
  });

  test("version takes precedence over tag", () => {
    expect(formatBlueprintRef({ id: "ns/name", tag: "stable", version: "0.1.0" })).toBe(
      "ns/name@0.1.0",
    );
  });
});
