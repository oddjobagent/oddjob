import { describe, expect, test } from "bun:test";

import { BlueprintParseError } from "./errors.ts";
import { parseBlueprint } from "./parse.ts";

const MIN = `
name = "g"
version = "0.1.0"
description = "grader test"
author = "demo"
model = "openrouter/x"
prompt = "noop"
`;

describe("parseBlueprint - [outcomes.grader]", () => {
  test("inline rubric_text parses", () => {
    const b = parseBlueprint(
      `${MIN}\n[outcomes]\nsuccess = "ok"\n[outcomes.grader]\nrubric_text = "# Rubric\\n- thing"\n`,
      { path: "/tmp/blueprint.toml" },
    );
    expect(b.outcomes?.grader?.rubricText).toContain("Rubric");
    expect(b.outcomes?.grader?.maxIterations).toBe(3);
    expect(b.outcomes?.grader?.onVerdict).toBe("feedback");
  });

  test("rubric_file ref parses (file resolution happens in loadBlueprint)", () => {
    const b = parseBlueprint(
      `${MIN}\n[outcomes]\nsuccess = "ok"\n[outcomes.grader]\nrubric_file = "rubric.md"\nmodel = "openrouter/anthropic/claude-haiku-4-5"\nmax_iterations = 5\non_verdict = "advisory"\n`,
      { path: "/tmp/blueprint.toml" },
    );
    expect(b.outcomes?.grader?.rubricFile).toBe("rubric.md");
    expect(b.outcomes?.grader?.model).toBe("openrouter/anthropic/claude-haiku-4-5");
    expect(b.outcomes?.grader?.maxIterations).toBe(5);
    expect(b.outcomes?.grader?.onVerdict).toBe("advisory");
  });

  test("rubric_text and rubric_file are mutually exclusive", () => {
    expect(() =>
      parseBlueprint(
        `${MIN}\n[outcomes]\nsuccess = "ok"\n[outcomes.grader]\nrubric_text = "x"\nrubric_file = "y.md"\n`,
        { path: "/tmp/blueprint.toml" },
      ),
    ).toThrow(BlueprintParseError);
  });

  test("must have one of rubric_text / rubric_file", () => {
    expect(() =>
      parseBlueprint(
        `${MIN}\n[outcomes]\nsuccess = "ok"\n[outcomes.grader]\nmax_iterations = 4\n`,
        { path: "/tmp/blueprint.toml" },
      ),
    ).toThrow(BlueprintParseError);
  });

  test("max_iterations is bounded 1..20", () => {
    expect(() =>
      parseBlueprint(
        `${MIN}\n[outcomes]\nsuccess = "ok"\n[outcomes.grader]\nrubric_text = "x"\nmax_iterations = 0\n`,
        { path: "/tmp/blueprint.toml" },
      ),
    ).toThrow(BlueprintParseError);
    expect(() =>
      parseBlueprint(
        `${MIN}\n[outcomes]\nsuccess = "ok"\n[outcomes.grader]\nrubric_text = "x"\nmax_iterations = 21\n`,
        { path: "/tmp/blueprint.toml" },
      ),
    ).toThrow(BlueprintParseError);
  });

  test("on_verdict only accepts known values", () => {
    expect(() =>
      parseBlueprint(
        `${MIN}\n[outcomes]\nsuccess = "ok"\n[outcomes.grader]\nrubric_text = "x"\non_verdict = "bogus"\n`,
        { path: "/tmp/blueprint.toml" },
      ),
    ).toThrow(BlueprintParseError);
  });
});
