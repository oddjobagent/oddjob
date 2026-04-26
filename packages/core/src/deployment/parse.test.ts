import { describe, expect, test } from "bun:test";

import { BlueprintParseError } from "../blueprint/errors.ts";
import { parseDeployment } from "./parse.ts";

const OPTS = { defaultName: "echo", blueprintId: "demo/echo" as const };

describe("parseDeployment - happy paths", () => {
  test("minimal", () => {
    const d = parseDeployment(`blueprint = "./blueprint.toml"`, OPTS);
    expect(d.name).toBe("echo");
    expect(d.triggers).toEqual([]);
    expect(d.channels).toEqual([]);
  });

  test("cron + console", () => {
    const t = `
blueprint = "./blueprint.toml"

[[trigger]]
type = "cron"
schedule = "0 8 * * *"
timezone = "Australia/Sydney"

[[channel]]
type = "console"
`;
    const d = parseDeployment(t, OPTS);
    expect(d.triggers[0]).toEqual({
      type: "cron",
      schedule: "0 8 * * *",
      timezone: "Australia/Sydney",
    });
    expect(d.channels[0]?.type).toBe("console");
  });

  test("limits with duration", () => {
    const t = `
blueprint = "./blueprint.toml"

[limits]
duration = "5m"
tool_calls = 50
budget = 0.5
`;
    const d = parseDeployment(t, OPTS);
    expect(d.limits?.durationMs).toBe(300_000);
    expect(d.limits?.toolCalls).toBe(50);
    expect(d.limits?.budgetUsd).toBe(0.5);
  });

  test("webhook with hmac", () => {
    const t = `
blueprint = "./blueprint.toml"

[[trigger]]
type = "webhook"
[trigger.auth]
kind = "hmac"
secret_ref = "WEBHOOK_HMAC"
header = "x-signature"
`;
    const d = parseDeployment(t, OPTS);
    const tr = d.triggers[0];
    expect(tr?.type).toBe("webhook");
    if (tr?.type === "webhook") {
      expect(tr.auth.kind).toBe("hmac");
    }
  });
});

describe("parseDeployment - sad paths", () => {
  test("malformed toml", () => {
    expect(() => parseDeployment("blueprint =", OPTS)).toThrow(BlueprintParseError);
  });

  test("invalid duration unit", () => {
    const t = `
blueprint = "./blueprint.toml"
[limits]
duration = "5days"
`;
    expect(() => parseDeployment(t, OPTS)).toThrow();
  });

  test("missing schedule on cron", () => {
    const t = `
blueprint = "./blueprint.toml"
[[trigger]]
type = "cron"
`;
    expect(() => parseDeployment(t, OPTS)).toThrow();
  });
});
