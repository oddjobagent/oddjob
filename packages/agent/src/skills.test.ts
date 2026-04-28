import { describe, expect, test } from "bun:test";

import { parseSkillFile } from "./skills.ts";

const VALID = `---
name: pdf
description: Read and summarise PDFs.
license: MIT
---

# PDF skill

Use the read_pdf tool to extract pages...
`;

describe("parseSkillFile", () => {
  test("parses valid frontmatter + body", () => {
    const s = parseSkillFile(VALID, "/skills/pdf/SKILL.md");
    expect(s.name).toBe("pdf");
    expect(s.description).toBe("Read and summarise PDFs.");
    expect(s.body).toContain("# PDF skill");
    expect(s.metadata.license).toBe("MIT");
  });

  test("rejects without frontmatter", () => {
    expect(() => parseSkillFile("# no frontmatter", "/x")).toThrow(/frontmatter/);
  });

  test("rejects without name", () => {
    expect(() => parseSkillFile(`---\ndescription: x\n---\nbody`, "/x")).toThrow(/name/);
  });
});
