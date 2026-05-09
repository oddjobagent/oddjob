// Focused test for codex round-15 R15-001: createRun + getRun roundtrip
// preserves parent_run_id, and updateRun doesn't clobber it.
//
// The full ctx.fork end-to-end test (script-mode.fork.test.ts) covers the
// in-memory parent→child output flow. This test pins the StateSqliteProvider
// schema layer so a future migration / row-shape change doesn't silently
// drop the parent linkage.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Run } from "@oddjob/core";

import { StateSqliteProvider } from "./provider.ts";

describe("StateSqliteProvider parent_run_id roundtrip (R15-001)", () => {
  let dir: string;
  let state: StateSqliteProvider;
  let parentDeploymentId: string;
  const blueprintId = "test/parent-id" as `${string}/${string}`;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "oddjob-parent-id-"));
    state = new StateSqliteProvider({ path: join(dir, "state.db") });
    await state.connect();
    // Seed a deployment so runs.deployment_id FK passes.
    await state.upsertBlueprint({
      id: blueprintId,
      name: "parent-id",
      namespace: "test",
      version: "0.0.1",
      description: "parent_run_id test blueprint",
      author: "test",
      tags: [],
      license: "MIT",
      prompt: "noop",
      tools: [],
      skills: [],
      connectors: {},
      scripts: {},
      memory: { store: "kv", retention: "0" },
      secrets: {},
      failOnToolError: false,
      path: "/synthetic/blueprint.toml",
      contentHash: "synthetic",
      schemaVersion: 1,
    } as Parameters<typeof state.upsertBlueprint>[0]);
    const dep = await state.createDeployment({
      blueprintId,
      blueprintTag: "latest",
      name: "parent-id-dep",
      triggers: [],
      channels: [],
    });
    parentDeploymentId = dep.id;
  });

  afterEach(async () => {
    await state.disconnect();
    await rm(dir, { recursive: true, force: true });
  });

  function makeRun(id: string, parentRunId?: string): Run {
    const r: Run = {
      id,
      deploymentId: parentDeploymentId,
      blueprintId,
      blueprintVersion: "0.0.1",
      blueprintHash: "synthetic",
      triggeredBy: "manual",
      status: "running",
      input: { x: 1 },
      tokenInput: 0,
      tokenOutput: 0,
      toolCalls: 0,
      createdAt: 1000,
      startedAt: 1000,
    };
    if (parentRunId) r.parentRunId = parentRunId;
    return r;
  }

  it("createRun + getRun preserves parentRunId", async () => {
    await state.createRun(makeRun("parent-1"));
    await state.createRun(makeRun("child-1", "parent-1"));
    const child = await state.getRun("child-1");
    expect(child).not.toBeNull();
    expect(child!.parentRunId).toBe("parent-1");
    const parent = await state.getRun("parent-1");
    expect(parent!.parentRunId).toBeUndefined();
  });

  it("updateRun doesn't clobber parentRunId", async () => {
    await state.createRun(makeRun("parent-2"));
    await state.createRun(makeRun("child-2", "parent-2"));
    await state.updateRun("child-2", {
      status: "complete",
      costUsd: 0.05,
      finishedAt: 2000,
    });
    const child = await state.getRun("child-2");
    expect(child!.parentRunId).toBe("parent-2"); // still linked
    expect(child!.status).toBe("complete");
    expect(child!.costUsd).toBe(0.05);
  });

  it("listRuns surfaces parentRunId for both top-level and forked runs", async () => {
    await state.createRun(makeRun("p"));
    await state.createRun(makeRun("c1", "p"));
    await state.createRun(makeRun("c2", "p"));
    const all = await state.listRuns({});
    const p = all.find((r) => r.id === "p");
    const c1 = all.find((r) => r.id === "c1");
    const c2 = all.find((r) => r.id === "c2");
    expect(p?.parentRunId).toBeUndefined();
    expect(c1?.parentRunId).toBe("p");
    expect(c2?.parentRunId).toBe("p");
  });
});
