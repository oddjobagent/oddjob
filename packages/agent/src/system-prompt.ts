import type { Blueprint, LoadedSkill } from "@oddjob/core";
import { buildSkillSystemPrompt } from "./tools/skills.ts";
import type { DynamicChannelDescriptor } from "./output-schema-compose.ts";

const HARNESS_PREAMBLE = `You are running inside the Oddjob agent harness. \
You have a single, well-scoped task defined by the user's Blueprint, which follows. \
Use the tools available, follow the plan implied by the prompt, and produce the requested output.

After your plan completes, call \`report_status({ outcome, reason })\` to record the result:
  - "success" — the goal stated in the Blueprint was achieved
  - "warning" — the goal was NOT achieved, but the failure is transient (network, rate-limit, MCP hiccup); the harness may retry the run
  - "error" — the goal was NOT achieved and retry will not help (auth, config, schema mismatch, missing input)

If the Blueprint declares an [outcomes] block, the warning / error definitions there are authoritative — match against them.

Tool results larger than 8KB are truncated to ~4KB head with a marker like \`[truncated — N bytes total. Call show_tool_result({toolUseId: "..."})...]\`. Use the \`show_tool_result\` tool to fetch additional bytes only when you actually need them — most tasks don't.`;

export interface AssembleSystemPromptOptions {
  blueprint: Blueprint;
  skills: LoadedSkill[];
  /** Caller-supplied trailing block (e.g. a deployment-level addendum). */
  extra?: string;
  /** Set to false to skip the harness preamble (testing). */
  preamble?: boolean;
  /** Channels with `mode = "dynamic"` whose contracts are exposed to the agent. */
  dynamicChannels?: readonly DynamicChannelDescriptor[];
}

/**
 * Three-zone system-prompt layout for prompt caching:
 *
 *   - **stable**: harness preamble + blueprint prompt + I/O schemas + outcomes
 *     + tool descriptions. Identical across every run of the same blueprint.
 *   - **semiStable**: skill bodies + dynamic-channel contracts. Stable per
 *     deployment but may shift when channels rebind or skills update.
 *   - **volatile**: caller-supplied `extra` (deployment addendum).
 *
 * Per-run input never appears here — it lives in the user message.
 *
 * Today pi-ai applies a single cache_control breakpoint to the joined system
 * prompt (Anthropic-style for OpenRouter+anthropic/* models). The zone split
 * is structural so a future enhancement can place separate breakpoints per
 * zone for finer cache invalidation. The current string return preserves the
 * pi-agent-core `Context.systemPrompt: string` contract.
 *
 * **Caching threshold caveat:** Anthropic Haiku 4.5 requires ≥2048 tokens of
 * cacheable content before cache_write fires. Smaller prompts won't show
 * cache hits even though markers are correctly applied. Real-world skill-rich
 * blueprints comfortably exceed this; small synthetic eval blueprints often
 * don't.
 */
export interface SystemPromptZones {
  stable: string;
  semiStable: string;
  volatile: string;
}

export function assembleSystemPromptZones(opts: AssembleSystemPromptOptions): SystemPromptZones {
  const { blueprint, skills, extra, preamble = true, dynamicChannels } = opts;

  const stableParts: string[] = [];
  if (preamble) stableParts.push(HARNESS_PREAMBLE);
  stableParts.push("## Blueprint");
  stableParts.push(blueprint.prompt.trim());
  const inputBlock = describeSchema(blueprint.inputSchema, "Input");
  if (inputBlock) stableParts.push(inputBlock);
  const outputBlock = describeSchema(blueprint.outputSchema, "Output");
  if (outputBlock) stableParts.push(outputBlock);
  const outcomesBlock = describeOutcomes(blueprint);
  if (outcomesBlock) stableParts.push(outcomesBlock);

  const semiStableParts: string[] = [];
  const channelsBlock = describeDynamicChannels(dynamicChannels ?? []);
  if (channelsBlock) semiStableParts.push(channelsBlock);
  const skillsBlock = buildSkillSystemPrompt(skills);
  if (skillsBlock) semiStableParts.push(skillsBlock);

  return {
    stable: stableParts.join("\n\n"),
    semiStable: semiStableParts.join("\n\n"),
    volatile: extra ?? "",
  };
}

export function assembleSystemPrompt(opts: AssembleSystemPromptOptions): string {
  const z = assembleSystemPromptZones(opts);
  const parts = [z.stable];
  if (z.semiStable) parts.push(z.semiStable);
  if (z.volatile) parts.push(z.volatile);
  return parts.join("\n\n");
}

function describeDynamicChannels(
  channels: readonly DynamicChannelDescriptor[],
): string | undefined {
  if (channels.length === 0) return undefined;
  const lines: string[] = [
    "## Channel deliveries",
    "Your run output will be routed to one or more channels. Each channel listed below has a contract — fill the matching entry in `output.structured.channels.<name>` to override per-run. Omit a channel entry to use deploy-time defaults.",
    "",
  ];
  for (const ch of channels) {
    lines.push(`### \`channels.${ch.name}\` (${ch.type})`);
    lines.push("```json");
    lines.push(JSON.stringify(ch.contract ?? { type: "object" }, null, 2));
    lines.push("```");
  }
  return lines.join("\n");
}

function describeSchema(
  schema: { schema: Record<string, unknown> } | undefined,
  label: string,
): string | undefined {
  if (!schema?.schema) return undefined;
  const inline = JSON.stringify(schema.schema, null, 2);
  return `## ${label} schema (JSON Schema)\n\`\`\`json\n${inline}\n\`\`\``;
}

function describeOutcomes(blueprint: Blueprint): string | undefined {
  const o = blueprint.outcomes;
  if (!o) return undefined;
  const lines: string[] = ["## Outcome contract"];
  if (o.success) lines.push(`- **success**: ${o.success}`);
  if (o.warning) lines.push(`- **warning** (retryable): ${o.warning}`);
  if (o.error) lines.push(`- **error** (fatal, no retry): ${o.error}`);
  if (o.warningTools.length > 0) {
    lines.push(
      `- Tools whose failure means warning: ${o.warningTools.map((t) => `\`${t}\``).join(", ")}`,
    );
  }
  if (o.errorTools.length > 0) {
    lines.push(
      `- Tools whose failure means error: ${o.errorTools.map((t) => `\`${t}\``).join(", ")}`,
    );
  }
  if (o.maxRetries > 0) {
    lines.push(`- Retries: up to ${o.maxRetries} on warning verdict (harness handles).`);
  }
  if (o.grader) {
    lines.push(
      `- An independent grader will score your output against a rubric. If you fall short on any criterion, you'll receive feedback and a chance to revise (up to ${o.grader.maxIterations} iterations).`,
      `- Treat the artifact (your final assistant message + any structured_output JSON) as the ONLY thing the grader will see — make it self-contained.`,
    );
  }
  lines.push("");
  lines.push(
    "Call `report_status({ outcome, reason })` exactly once before terminating. The verdict is authoritative.",
  );
  return lines.join("\n");
}
