import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fauxAssistantMessage, fauxText, registerFauxProvider } from "@mariozechner/pi-ai";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { runOnce } from "./loop.ts";
import { SandboxProcessProvider } from "../../../../packages/providers/sandbox-process/src/provider.ts";
import { loadBlueprint } from "../blueprint/index.ts";

let dir: string;
const sandbox = new SandboxProcessProvider();
const testEnv = { provider: sandbox, config: { type: "local" as const } };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-grader-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const RUBRIC = `# Test rubric
## Greeting
- Output contains the word "hello"
## Length
- Output is at most 80 chars
`;

const SATISFIED = `\`\`\`json
{
  "result": "satisfied",
  "explanation": "all good",
  "criteria": [
    {"criterion": "contains hello", "pass": true},
    {"criterion": "<=80 chars", "pass": true}
  ]
}
\`\`\``;

const NEEDS_REVISION = `\`\`\`json
{
  "result": "needs_revision",
  "explanation": "missing 'hello' keyword",
  "criteria": [
    {"criterion": "contains hello", "pass": false, "reason": "no 'hello' found"},
    {"criterion": "<=80 chars", "pass": true}
  ]
}
\`\`\``;

describe("runOnce + [outcomes.grader]", () => {
  test("satisfied on first iteration → run.status=complete + verdict=success", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-grader-sat" }] });
    reg.setResponses([
      // 1st: agent
      fauxAssistantMessage([fauxText("hello world")], { stopReason: "stop" }),
      // 2nd: grader
      fauxAssistantMessage([fauxText(SATISFIED)], { stopReason: "stop" }),
    ]);

    const bp = await loadBlueprint("./jobs/echo", { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: {
        ...bp,
        model: "faux/test-grader-sat",
        outcomes: {
          success: "produce a short greeting",
          warningTools: [],
          errorTools: [],
          maxRetries: 0,
          retryBackoffMs: 0,
          grader: {
            rubricText: RUBRIC,
            maxIterations: 3,
            onVerdict: "feedback",
          },
        },
      },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "say hi",
    });

    expect(r.graderEvaluations?.length).toBe(1);
    expect(r.graderEvaluations?.[0]?.result).toBe("satisfied");
    expect(r.verdict?.outcome).toBe("success");
    expect(r.run.status).toBe("complete");
    reg.unregister();
  });

  test("needs_revision then satisfied → 2 iterations, success", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-grader-rev" }] });
    reg.setResponses([
      // 1st agent run: bad output
      fauxAssistantMessage([fauxText("howdy")], { stopReason: "stop" }),
      // 1st grader: needs_revision
      fauxAssistantMessage([fauxText(NEEDS_REVISION)], { stopReason: "stop" }),
      // 2nd agent run: corrected
      fauxAssistantMessage([fauxText("hello there")], { stopReason: "stop" }),
      // 2nd grader: satisfied
      fauxAssistantMessage([fauxText(SATISFIED)], { stopReason: "stop" }),
    ]);

    const bp = await loadBlueprint("./jobs/echo", { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: {
        ...bp,
        model: "faux/test-grader-rev",
        outcomes: {
          success: "produce a short greeting",
          warningTools: [],
          errorTools: [],
          maxRetries: 0,
          retryBackoffMs: 0,
          grader: {
            rubricText: RUBRIC,
            maxIterations: 3,
            onVerdict: "feedback",
          },
        },
      },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "say hi",
    });

    expect(r.graderEvaluations?.length).toBe(2);
    expect(r.graderEvaluations?.[0]?.result).toBe("needs_revision");
    expect(r.graderEvaluations?.[1]?.result).toBe("satisfied");
    expect(r.run.status).toBe("complete");
    expect(r.verdict?.outcome).toBe("success");
    reg.unregister();
  });

  test("max_iterations exhausted with onVerdict=feedback → warning + retriable", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-grader-max" }] });
    // 2 iterations, both bad. After max_iterations the harness emits warning.
    reg.setResponses([
      fauxAssistantMessage([fauxText("howdy")], { stopReason: "stop" }),
      fauxAssistantMessage([fauxText(NEEDS_REVISION)], { stopReason: "stop" }),
      fauxAssistantMessage([fauxText("howdy still")], { stopReason: "stop" }),
      fauxAssistantMessage([fauxText(NEEDS_REVISION)], { stopReason: "stop" }),
    ]);

    const bp = await loadBlueprint("./jobs/echo", { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: {
        ...bp,
        model: "faux/test-grader-max",
        outcomes: {
          success: "produce a short greeting",
          warningTools: [],
          errorTools: [],
          maxRetries: 2,
          retryBackoffMs: 0,
          grader: {
            rubricText: RUBRIC,
            maxIterations: 2,
            onVerdict: "feedback",
          },
        },
      },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "say hi",
    });

    expect(r.graderEvaluations?.length).toBe(2);
    expect(r.verdict?.outcome).toBe("warning");
    expect(r.run.status).toBe("failed");
    expect(r.retriable).toBe(true);
    reg.unregister();
  });

  test("grader returns 'failed' (rubric incompatible) → run errored, not retriable", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-grader-fail" }] });
    reg.setResponses([
      fauxAssistantMessage([fauxText("hello world")], { stopReason: "stop" }),
      fauxAssistantMessage(
        [
          fauxText(
            '```json\n{"result":"failed","explanation":"rubric contradicts the description","criteria":[]}\n```',
          ),
        ],
        { stopReason: "stop" },
      ),
    ]);

    const bp = await loadBlueprint("./jobs/echo", { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: {
        ...bp,
        model: "faux/test-grader-fail",
        outcomes: {
          success: "produce a short greeting",
          warningTools: [],
          errorTools: [],
          maxRetries: 1,
          retryBackoffMs: 0,
          grader: {
            rubricText: RUBRIC,
            maxIterations: 3,
            onVerdict: "feedback",
          },
        },
      },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "say hi",
    });

    expect(r.graderEvaluations?.[0]?.result).toBe("failed");
    expect(r.verdict?.outcome).toBe("error");
    expect(r.run.status).toBe("failed");
    expect(r.retriable).toBe(false);
    reg.unregister();
  });

  test("onVerdict=advisory leaves run successful even when grader unhappy", async () => {
    const reg = registerFauxProvider({ models: [{ id: "test-grader-adv" }] });
    reg.setResponses([
      fauxAssistantMessage([fauxText("howdy")], { stopReason: "stop" }),
      fauxAssistantMessage([fauxText(NEEDS_REVISION)], { stopReason: "stop" }),
      fauxAssistantMessage([fauxText("howdy still")], { stopReason: "stop" }),
      fauxAssistantMessage([fauxText(NEEDS_REVISION)], { stopReason: "stop" }),
    ]);

    const bp = await loadBlueprint("./jobs/echo", { validate: true, checkFs: true });
    const r = await runOnce({
      blueprint: {
        ...bp,
        model: "faux/test-grader-adv",
        outcomes: {
          success: "produce a short greeting",
          warningTools: [],
          errorTools: [],
          maxRetries: 0,
          retryBackoffMs: 0,
          grader: {
            rubricText: RUBRIC,
            maxIterations: 2,
            onVerdict: "advisory",
          },
        },
      },
      llm: { model: reg.getModel() },
      environment: testEnv,
      input: "say hi",
    });

    expect(r.graderEvaluations?.length).toBe(2);
    // advisory: no harness verdict change → status complete, no verdict set
    expect(r.run.status).toBe("complete");
    expect(r.verdict).toBeUndefined();
    reg.unregister();
  });
});
