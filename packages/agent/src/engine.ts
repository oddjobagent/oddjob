// EngineLLM: the agent loop's view of the engine. Lets the harness ask for a
// resolved model by role (default/advisor/grader/...) without knowing about
// plugins, registries, or credential lookup.

import type { Blueprint } from "@oddjob/core";
import type { ModelRole, ResolvedRoleModel } from "@oddjob/core";
import type { RoleAssignment, RoleResolver } from "@oddjob/core";

export interface EngineLLM {
  /**
   * Resolve a role to a usable model + apiKey. Throws when the role is not
   * configured (deployment override → engine assignment → default fallback →
   * legacy blueprint.model). Caller should treat undefined-role as fatal.
   */
  forRole(role: ModelRole): Promise<ResolvedRoleModel>;
  /**
   * One-shot ask the advisor for a free-form opinion. Convenience for tools
   * that want to consult a stronger model mid-loop without setting up their
   * own pi-ai harness.
   */
  askAdvisor(prompt: string, opts?: AskAdvisorOptions): Promise<string>;
  /** True if the role has a usable assignment without resolving fully. */
  hasRole(role: ModelRole): boolean;
}

export interface AskAdvisorOptions {
  /** Extra system prompt prepended to the advisor message. */
  systemPrompt?: string;
  signal?: AbortSignal;
}

export interface CreateEngineLLMOptions {
  resolver: RoleResolver;
  /**
   * Blueprint context: lets the resolver fall back to legacy
   * `blueprint.model` for the "default" role, and pulls the secret reference
   * from the blueprint's [secrets] block for legacy resolution.
   */
  blueprint?: Pick<Blueprint, "model" | "secrets">;
  /** Per-deployment role overrides (parsed from model_role_overrides_json). */
  deploymentOverrides?: Record<string, RoleAssignment>;
}

export function createEngineLLM(opts: CreateEngineLLMOptions): EngineLLM {
  const { resolver, blueprint, deploymentOverrides } = opts;
  const legacyModel = blueprint?.model;
  const legacySecretRef =
    blueprint?.secrets?.openrouter ?? blueprint?.secrets?.api ?? blueprint?.secrets?.anthropic;
  return {
    async forRole(role) {
      return resolver.resolve(role, deploymentOverrides, legacyModel, legacySecretRef);
    },
    hasRole(role) {
      return resolver.hasRole(role, deploymentOverrides, legacyModel);
    },
    async askAdvisor(prompt, askOpts) {
      const { completeSimple } = await import("@mariozechner/pi-ai");
      const resolved = await resolver.resolve(
        "advisor",
        deploymentOverrides,
        legacyModel,
        legacySecretRef,
      );
      const messages = [{ role: "user" as const, content: prompt, timestamp: Date.now() }];
      const response = await completeSimple(
        resolved.model,
        { systemPrompt: askOpts?.systemPrompt ?? "You are a senior advisor.", messages },
        { apiKey: resolved.apiKey, signal: askOpts?.signal },
      );
      const blocks = response.content ?? [];
      const parts: string[] = [];
      for (const b of blocks) {
        if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
      }
      return parts.join("\n").trim();
    },
  };
}
