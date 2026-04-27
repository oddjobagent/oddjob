import { describe, expect, test } from "bun:test";

import {
  PluginRegistry,
  RoleNotConfiguredError,
  RoleResolver,
  type EngineModelRoleRecord,
  type ProviderCredentialRecord,
  type ResolvedRoleModel,
} from "./index.ts";
import { definePlugin } from "../../../sdk/src/index.ts";

function buildRegistry(): {
  registry: PluginRegistry;
  createClientCalls: Array<{ id: string; key?: string }>;
} {
  const registry = new PluginRegistry();
  const createClientCalls: Array<{ id: string; key?: string }> = [];
  const fakeProvider = (id: string) =>
    definePlugin({ slug: id, version: "0.0.1", description: "x" }, (b) =>
      b.modelProvider({
        id,
        displayName: id,
        capabilities: { tools: true, streaming: true, vision: false, reasoning: false },
        listModels: () => [
          {
            id: `${id}-model`,
            displayName: `${id} model`,
            contextWindow: 1000,
            maxOutput: 100,
            inputCostPerMillion: 1,
            outputCostPerMillion: 2,
            supports: { tools: true, streaming: true, vision: false, reasoning: false },
          },
        ],
        createClient: (modelId, cred): ResolvedRoleModel => {
          createClientCalls.push({ id: modelId, key: cred.apiKey });
          return {
            model: { id: modelId } as ResolvedRoleModel["model"],
            apiKey: cred.apiKey,
          };
        },
      }),
    );
  registry.register(fakeProvider("p1"), "bundled");
  registry.register(fakeProvider("p2"), "bundled");
  return { registry, createClientCalls };
}

describe("RoleResolver", () => {
  test("resolves engine assignment for default role", async () => {
    const { registry, createClientCalls } = buildRegistry();
    const engineRoles = new Map<string, EngineModelRoleRecord>([
      [
        "default",
        {
          role: "default",
          providerSlug: "p1",
          modelId: "p1-model",
          credentialName: "default",
          source: "config",
          updatedAt: 0,
        },
      ],
    ]);
    const credentials = new Map<string, Map<string, ProviderCredentialRecord>>([
      [
        "p1",
        new Map([
          [
            "default",
            {
              providerSlug: "p1",
              credentialName: "default",
              apiKeySecret: undefined,
              optionsJson: undefined,
              source: "config",
              createdAt: 0,
              updatedAt: 0,
            },
          ],
        ]),
      ],
    ]);
    const resolver = new RoleResolver({
      registry,
      engineRoles: () => engineRoles,
      credentials: () => credentials,
    });
    const result = await resolver.resolve("default", undefined, undefined, undefined);
    expect(result.model.id).toBe("p1-model");
    expect(createClientCalls).toHaveLength(1);
  });

  test("falls back to default role when non-default role unset", async () => {
    const { registry } = buildRegistry();
    const engineRoles = new Map<string, EngineModelRoleRecord>([
      [
        "default",
        {
          role: "default",
          providerSlug: "p1",
          modelId: "p1-model",
          credentialName: "default",
          source: "config",
          updatedAt: 0,
        },
      ],
    ]);
    const resolver = new RoleResolver({
      registry,
      engineRoles: () => engineRoles,
      credentials: () => new Map(),
    });
    const result = await resolver.resolve("advisor", undefined);
    expect(result.model.id).toBe("p1-model");
  });

  test("deployment override beats engine assignment", async () => {
    const { registry } = buildRegistry();
    const engineRoles = new Map<string, EngineModelRoleRecord>([
      [
        "default",
        {
          role: "default",
          providerSlug: "p1",
          modelId: "p1-model",
          credentialName: "default",
          source: "config",
          updatedAt: 0,
        },
      ],
    ]);
    const resolver = new RoleResolver({
      registry,
      engineRoles: () => engineRoles,
      credentials: () => new Map(),
    });
    const result = await resolver.resolve(
      "default",
      {
        default: {
          providerSlug: "p2",
          modelId: "p2-model",
          credentialName: "default",
        },
      },
      undefined,
    );
    expect(result.model.id).toBe("p2-model");
  });

  test("legacy fallback resolves blueprint.model when no engine role", async () => {
    const { registry } = buildRegistry();
    const calls: string[] = [];
    const resolver = new RoleResolver({
      registry,
      engineRoles: () => new Map(),
      credentials: () => new Map(),
      legacy: {
        async resolve(modelString) {
          calls.push(modelString);
          return { model: { id: modelString } as ResolvedRoleModel["model"] };
        },
      },
    });
    const result = await resolver.resolve("default", undefined, "openai/gpt-4o");
    expect(result.model.id).toBe("openai/gpt-4o");
    expect(calls).toEqual(["openai/gpt-4o"]);
  });

  test("throws when no path available", async () => {
    const { registry } = buildRegistry();
    const resolver = new RoleResolver({
      registry,
      engineRoles: () => new Map(),
      credentials: () => new Map(),
    });
    await expect(resolver.resolve("default", undefined)).rejects.toBeInstanceOf(
      RoleNotConfiguredError,
    );
  });

  test("hasRole returns true when default exists for non-default role", () => {
    const { registry } = buildRegistry();
    const engineRoles = new Map<string, EngineModelRoleRecord>([
      [
        "default",
        {
          role: "default",
          providerSlug: "p1",
          modelId: "p1-model",
          credentialName: "default",
          source: "config",
          updatedAt: 0,
        },
      ],
    ]);
    const resolver = new RoleResolver({
      registry,
      engineRoles: () => engineRoles,
      credentials: () => new Map(),
    });
    expect(resolver.hasRole("advisor", undefined)).toBe(true);
    expect(resolver.hasRole("grader", undefined)).toBe(true);
    expect(resolver.hasRole("default", undefined)).toBe(true);
  });
});
