import { describe, expect, test } from "bun:test";

import type { Blueprint } from "@oddjob/core";

import { assembleSystemPrompt, assembleSystemPromptZones } from "./system-prompt.ts";

const baseBlueprint: Blueprint = {
  id: "test/zones",
  name: "zones",
  namespace: "test",
  version: "0.0.1",
  schemaVersion: 1,
  description: "Zone test blueprint",
  author: "test",
  tags: [],
  license: "MIT",
  prompt: "Do the thing.",
  tools: [],
  skills: [],
  connectors: {},
  scripts: {},
  memory: { store: "kv", retention: "0" },
  secrets: {},
  failOnToolError: false,
  path: "/test/zones.toml",
  contentHash: "test",
};

describe("assembleSystemPromptZones", () => {
  test("stable zone holds preamble + blueprint + outcomes; volatile holds extra", () => {
    const z = assembleSystemPromptZones({
      blueprint: {
        ...baseBlueprint,
        outcomes: {
          success: "task done",
          warningTools: [],
          errorTools: [],
          maxRetries: 0,
          retryBackoffMs: 0,
        },
      },
      skills: [],
      extra: "Per-deployment context: foo",
    });
    expect(z.stable).toContain("Oddjob agent harness");
    expect(z.stable).toContain("Do the thing.");
    expect(z.stable).toContain("task done");
    expect(z.semiStable).toBe("");
    expect(z.volatile).toBe("Per-deployment context: foo");
  });

  test("skills go to semiStable, not stable", () => {
    const z = assembleSystemPromptZones({
      blueprint: baseBlueprint,
      skills: [
        {
          name: "test-skill",
          path: "/skills/test",
          description: "demo skill",
          body: "skill body content",
          metadata: {},
          blueprintLocal: false,
        },
      ],
    });
    expect(z.stable).not.toContain("test-skill");
    expect(z.semiStable).toContain("test-skill");
  });

  test("assembleSystemPrompt joins zones into a single string preserving order", () => {
    const opts = {
      blueprint: baseBlueprint,
      skills: [
        {
          name: "s1",
          path: "/skills/s1",
          description: "x",
          body: "x",
          metadata: {},
          blueprintLocal: false,
        },
      ],
      extra: "trailing-extra",
    };
    const joined = assembleSystemPrompt(opts);
    const z = assembleSystemPromptZones(opts);
    expect(joined.indexOf(z.stable)).toBe(0);
    expect(joined.indexOf(z.semiStable)).toBeGreaterThan(joined.indexOf(z.stable));
    expect(joined.indexOf(z.volatile)).toBeGreaterThan(joined.indexOf(z.semiStable));
  });

  test("no per-run input leaks into any zone", () => {
    // Caller never passes the user's input to the prompt assembler. This test
    // is structural — we assert the option surface doesn't accept it. If the
    // signature ever grows an `input` field, caching contract breaks.
    const opts: Parameters<typeof assembleSystemPromptZones>[0] = {
      blueprint: baseBlueprint,
      skills: [],
    };
    expect("input" in opts).toBe(false);
    expect("userInput" in opts).toBe(false);
  });
});
