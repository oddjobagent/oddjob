import { fauxAssistantMessage, fauxText, registerFauxProvider } from "@mariozechner/pi-ai";
import { describe, expect, test } from "bun:test";

import { loadBlueprint } from "../blueprint/index.ts";
import { runOnce } from "./loop.ts";
import { SandboxProcessProvider } from "../../../../packages/providers/sandbox-process/src/provider.ts";

const sandbox = new SandboxProcessProvider();
const testEnv = { provider: sandbox, config: { type: "local" as const } };

const SATISFIED = `\`\`\`json
{
  "result": "satisfied",
  "explanation": "Single paragraph, 60 words, names the feature, lists a benefit, no superlatives.",
  "criteria": [
    {"criterion": "single paragraph", "pass": true},
    {"criterion": "40-120 words", "pass": true},
    {"criterion": "names the feature", "pass": true},
    {"criterion": "concrete benefit", "pass": true},
    {"criterion": "no superlatives", "pass": true},
    {"criterion": "factual tone", "pass": true}
  ]
}
\`\`\``;

const NEEDS_REVISION = `\`\`\`json
{
  "result": "needs_revision",
  "explanation": "Used the word 'revolutionary'. Drop superlatives.",
  "criteria": [
    {"criterion": "single paragraph", "pass": true},
    {"criterion": "40-120 words", "pass": true},
    {"criterion": "names the feature", "pass": true},
    {"criterion": "concrete benefit", "pass": true},
    {"criterion": "no superlatives", "pass": false, "reason": "remove 'revolutionary'"}
  ]
}
\`\`\``;

const BAD_PARA = "Our revolutionary new dashboard is here and we know you're going to love it.";

const GOOD_PARA =
  "The dashboard now shows runs in real time. Each row links to its full event log, lets you re-run a deployment, and surfaces token costs alongside latency. The redesign also adds a sidebar of recent webhook deliveries so on-call engineers can confirm an alert fired without leaving the page. Existing keyboard shortcuts continue to work; no migration is required.";

describe("grader-demo blueprint", () => {
  test("loads rubric file from disk", async () => {
    const bp = await loadBlueprint("./jobs/grader-demo", { validate: true, checkFs: true });
    expect(bp.id).toBe("demo/grader-demo");
    expect(bp.outcomes?.grader?.rubricFile).toBe("rubric.md");
    expect(bp.outcomes?.grader?.rubricLoaded).toContain("Release-note rubric");
    expect(bp.outcomes?.grader?.maxIterations).toBe(3);
  });

  test("end-to-end with faux LLM: revision then satisfied", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-grader-demo" }] });
    reg.setResponses([
      fauxAssistantMessage([fauxText(BAD_PARA)], { stopReason: "stop" }),
      fauxAssistantMessage([fauxText(NEEDS_REVISION)], { stopReason: "stop" }),
      fauxAssistantMessage([fauxText(GOOD_PARA)], { stopReason: "stop" }),
      fauxAssistantMessage([fauxText(SATISFIED)], { stopReason: "stop" }),
    ]);

    const bp = await loadBlueprint("./jobs/grader-demo", { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: { ...bp, model: "faux/test-grader-demo" },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "We added live run streaming to the dashboard.",
    });

    expect(r.graderEvaluations?.length).toBe(2);
    expect(r.graderEvaluations?.[0]?.result).toBe("needs_revision");
    expect(r.graderEvaluations?.[1]?.result).toBe("satisfied");
    expect(r.run.status).toBe("complete");
    expect(r.verdict?.outcome).toBe("success");
    reg.unregister();
  });
});
