// `classifier` routing strategy — Phase 2 of agent_core_eval.
//
// Runs a 1-shot Haiku classification on (blueprint.prompt, input) →
// "simple" | "standard" | "complex" → maps to a configured tier model.
// On classifier failure (network, malformed output) we WARN and fall
// back to the blueprint default — never fail the run on routing.

import type { RoutingFileConfig } from "@oddjob/core";

import type { RoutingContext, RoutingDecision, RoutingStrategy } from "./strategy.ts";

export type ClassifierLabel = "simple" | "standard" | "complex";

const VALID_LABELS: readonly ClassifierLabel[] = ["simple", "standard", "complex"] as const;

// No DEFAULT_CLASSIFIER_MODEL constant. v1 leaves it undefined; in that
// case the classifier call uses the run's main llm (same model the
// blueprint would have used). The user opts into cheap-tier
// classification by setting `engine.routing.classifier_model` to a
// provider-native id (e.g. `claude-haiku-4-5` on Anthropic native;
// `anthropic/claude-haiku-4.5` on OpenRouter). Picking a sensible
// default per provider is left to v1.1 once we have a provider catalog.

// Full classifier prompt — system context + task framing in one user
// message because the runtime's `classify()` helper takes a single
// prompt string. Caching is irrelevant here (1-shot, max 8 tokens out).
const CLASSIFIER_PROMPT_PREAMBLE = `You categorize coding/research/data-extraction tasks by complexity.

Output EXACTLY ONE WORD — one of:
  simple   — single-step lookup or trivial transform (1-3 turns expected)
  standard — multi-step but well-defined, no deep reasoning (4-10 turns)
  complex  — multi-source synthesis, planning, or non-obvious reasoning (10+ turns)

No commentary. No punctuation. One word, lowercase.

---`;

export interface ClassifierConfig {
  /** Tier ladder. Each label maps to a model id; missing labels = blueprint default. */
  tiers: NonNullable<RoutingFileConfig["tiers"]>;
  /** Model id for the classifier itself. Default DEFAULT_CLASSIFIER_MODEL. */
  classifierModel?: string;
  /**
   * Optional logger for the warn-and-fall-back path. When absent, falls
   * back to console.warn with `[oddjob:routing]` prefix.
   */
  onWarn?: (msg: string) => void;
}

export function createClassifierStrategy(cfg: ClassifierConfig): RoutingStrategy {
  const classifierModel = cfg.classifierModel; // undefined = use run's main llm
  return {
    name: "classifier",
    async selectInitial(ctx: RoutingContext): Promise<RoutingDecision> {
      const prompt = buildClassifierPrompt(ctx.blueprint.prompt, ctx.input);
      let raw: string;
      try {
        const classifyOpts: { model?: string; maxTokens?: number } = { maxTokens: 8 };
        if (classifierModel) classifyOpts.model = classifierModel;
        raw = await ctx.classify(prompt, classifyOpts);
      } catch (err) {
        warn(cfg, `classifier call failed (${(err as Error).message}); falling back to blueprint default`);
        return {
          reason: "classifier: error → fallback to blueprint default",
          meta: { strategy: "classifier", error: (err as Error).message },
        };
      }
      const label = parseLabel(raw);
      if (!label) {
        warn(cfg, `classifier returned non-label '${raw.slice(0, 80)}'; falling back to blueprint default`);
        return {
          reason: "classifier: unparseable → fallback to blueprint default",
          meta: { strategy: "classifier", ...(classifierModel ? { classifierModel } : {}), rawLabel: raw },
        };
      }
      const targetModelId = cfg.tiers[label];
      if (!targetModelId) {
        return {
          reason: `classifier: ${label} → no tier mapping → blueprint default`,
          meta: { strategy: "classifier", ...(classifierModel ? { classifierModel } : {}), rawLabel: raw, label },
        };
      }
      let llm;
      try {
        llm = await ctx.resolveModel(targetModelId);
      } catch (err) {
        warn(cfg, `classifier picked '${label}' → '${targetModelId}' but resolve failed: ${(err as Error).message}; falling back`);
        return {
          reason: `classifier: ${label} → '${targetModelId}' resolve-failed → blueprint default`,
          meta: {
            strategy: "classifier",
            ...(classifierModel ? { classifierModel } : {}),
            rawLabel: raw,
            label,
            mappedModel: targetModelId,
            resolveError: (err as Error).message,
          },
        };
      }
      return {
        llm,
        reason: `classifier: ${label} → ${targetModelId}`,
        meta: {
          strategy: "classifier",
          ...(classifierModel ? { classifierModel } : {}),
          rawLabel: raw,
          label,
          mappedModel: targetModelId,
        },
      };
    },
  };
}

// Cap classifier input preview at 2 KB. Webhook bodies / pasted logs /
// large prompts can blow up the routing call's cost + latency before the
// main run starts. The classifier's job is "is this simple, standard, or
// complex" — the first 2 KB is enough signal. (codex round-17 #4)
const INPUT_PREVIEW_BYTES = 2 * 1024;
const BLUEPRINT_PROMPT_PREVIEW_BYTES = 1 * 1024;

function buildClassifierPrompt(blueprintPrompt: string, input: unknown): string {
  const promptStr = truncate(blueprintPrompt, BLUEPRINT_PROMPT_PREVIEW_BYTES);
  const inputStr = truncate(formatInput(input), INPUT_PREVIEW_BYTES);
  return `${CLASSIFIER_PROMPT_PREAMBLE}\n\nBlueprint task:\n${promptStr}\n\nUser input:\n${inputStr}\n\nLabel:`;
}

function truncate(s: string, maxBytes: number): string {
  if (s.length <= maxBytes) return s;
  return `${s.slice(0, maxBytes)}\n…[truncated ${s.length - maxBytes} bytes for routing classification]`;
}

function formatInput(input: unknown): string {
  if (input === null || input === undefined) return "(none)";
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function parseLabel(raw: string): ClassifierLabel | undefined {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  for (const label of VALID_LABELS) {
    if (cleaned === label || cleaned.startsWith(label)) return label;
  }
  return undefined;
}

function warn(cfg: ClassifierConfig, msg: string): void {
  if (cfg.onWarn) {
    cfg.onWarn(msg);
    return;
  }
  // eslint-disable-next-line no-console -- routing diagnostic
  console.warn(`[oddjob:routing] ${msg}`);
}
