import { describe, expect, test } from "bun:test";

import type { LoadedSkill } from "@oddjob/core";

import { buildSkillSystemPrompt, buildSkillTool } from "./skills.ts";

const SKILL_A: LoadedSkill = {
  name: "researcher",
  description: "Research a topic and produce a fact-graph",
  path: "/skills/researcher",
  body: "## Researcher\n\nFollow these instructions to research:\n\n[long body content]",
  metadata: {},
  blueprintLocal: false,
};

const SKILL_B: LoadedSkill = {
  name: "drafter",
  description: "Draft an article from a fact-graph",
  path: "/skills/drafter",
  body: "## Drafter\n\nDraft instructions go here.",
  metadata: {},
  blueprintLocal: false,
};

describe("buildSkillSystemPrompt (JIT manifest)", () => {
  test("emits ONLY name + description per skill (not bodies) — saves tokens", () => {
    const prompt = buildSkillSystemPrompt([SKILL_A, SKILL_B]);
    expect(prompt).toContain("researcher");
    expect(prompt).toContain("Research a topic");
    expect(prompt).toContain("drafter");
    expect(prompt).toContain("Draft an article");
    // Bodies must NOT appear in the system prompt — they ride on `skill_load` tool result
    expect(prompt).not.toContain("[long body content]");
    expect(prompt).not.toContain("Draft instructions go here");
  });

  test("references the skill_load tool by name", () => {
    const prompt = buildSkillSystemPrompt([SKILL_A]);
    expect(prompt).toContain("skill_load");
  });

  test("empty skill list returns empty string", () => {
    expect(buildSkillSystemPrompt([])).toBe("");
  });
});

describe("buildSkillTool", () => {
  test("returns null for empty skill list (tool not registered)", () => {
    expect(buildSkillTool({ skills: [] })).toBeNull();
  });

  test("returns the full body when skill_load is called with a known name", async () => {
    const tool = buildSkillTool({ skills: [SKILL_A] });
    expect(tool).not.toBeNull();
    const r = await tool!.execute("call-1", { name: "researcher" }, undefined);
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain("[long body content]");
  });

  test("returns helpful error for unknown skill name", async () => {
    const tool = buildSkillTool({ skills: [SKILL_A, SKILL_B] });
    const r = await tool!.execute("call-2", { name: "nonexistent" }, undefined);
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain("unknown skill");
    expect(text).toContain("researcher");
    expect(text).toContain("drafter");
  });
});
