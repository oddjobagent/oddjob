import type { Connector } from "./connector.ts";
import type { Skill } from "./skill.ts";

export interface Blueprint {
  id: BlueprintId;
  name: string;
  namespace: string;
  version: string;
  schemaVersion: 1;
  description: string;
  author: string;
  tags: string[];
  license: string;
  /**
   * @deprecated since 0.0.x — engine model roles are the supported path.
   * Resolves to the "default" role at dispatch when no role assignment exists.
   */
  model?: string;
  prompt: string;
  /** Required engine roles ("default" / "advisor" / "grader" / custom). */
  requires?: { roles: string[] };
  /**
   * Allowlist of built-in harness tools the blueprint opts into
   * (`bash`, `read`, `write`, `edit`, `grep`, `find`, `ls`,
   * `web_fetch`, `web_search`, `python_repl`, `javascript_repl`).
   * Empty / omitted = no built-ins. Unknown names fail validation.
   */
  tools: string[];
  /**
   * Per-tool runtime policy. Keys are tool names from `tools`.
   * `confirm = true` means the harness will pause before that tool fires
   * and wait for an explicit allow/deny via `POST /api/v1/runs/:id/confirm`.
   */
  toolPolicies?: Record<string, { confirm?: boolean }>;
  skills: string[];
  connectors: Record<string, Connector>;
  scripts: Record<string, string>;
  memory: BlueprintMemory;
  secrets: Record<string, string>;
  /**
   * If true (default), any tool call returning isError flips the run to
   * `status: "failed"` even when the agent finishes its plan gracefully.
   * Set to false to keep the legacy graceful-recovery behavior — the agent
   * sees the error tool-result, decides what to do, and the run can still
   * complete cleanly.
   */
  failOnToolError: boolean;
  outcomes?: BlueprintOutcomes;
  outputSchema?: BlueprintOutputSchema;
  inputSchema?: BlueprintOutputSchema;
  /**
   * Set when the blueprint declared `[output_schema] json_schema_file = "..."`
   * but the file hasn't been resolved yet (sync parse path). `loadBlueprint`
   * resolves it and clears this field. Server-side parse rejects unresolved
   * sidecar references — sidecar resolution is a CLI/load-time convenience.
   */
  outputSchemaFile?: string;
  inputSchemaFile?: string;
  path: string;
  contentHash: string;
  sourceToml?: string;
  loadedSkills?: Skill[];
}

export interface BlueprintMemory {
  store: "kv" | "vector" | "both";
  retention: string;
}

export interface BlueprintOutputSchema {
  type: "json-schema";
  schema: Record<string, unknown>;
}

export interface BlueprintOutcomes {
  /** Plain-language description of what success looks like. Injected into system prompt. */
  success?: string;
  /** Plain-language description of transient/retryable failures. */
  warning?: string;
  /** Plain-language description of fatal failures. */
  error?: string;
  /** Tool names whose isError result classifies the run as warning (retry-eligible). */
  warningTools: string[];
  /** Tool names whose isError result classifies the run as error (no retry). */
  errorTools: string[];
  /** Max retries on a warning verdict. 0 disables retry. */
  maxRetries: number;
  /** Backoff for the first retry (subsequent ones double). */
  retryBackoffMs: number;
  /** Optional rubric-based grader sub-agent (CMA-style "outcome"). */
  grader?: BlueprintGrader;
}

export interface BlueprintGrader {
  /** Inline rubric body (markdown). Mutually exclusive with rubricFile. */
  rubricText?: string;
  /** Path to a markdown rubric file, relative to the blueprint dir. */
  rubricFile?: string;
  /** Loaded rubric body (filled by loadBlueprint when rubricFile is set). */
  rubricLoaded?: string;
  /** Cheap grader model. Falls back to the blueprint's model when omitted. */
  model?: string;
  /** Max grader→agent iteration cycles within a single run. */
  maxIterations: number;
  /** What to do when the grader finally gives up (after maxIterations). */
  onVerdict: "feedback" | "fail-only" | "advisory";
}

export type BlueprintId = `${string}/${string}`;

/**
 * Parsed reference to a blueprint, optionally pinned by tag or version.
 * Source string forms (Docker-style):
 *   "ns/name"               -> { id, tag: "latest" } (implicit)
 *   "ns/name:tag"           -> { id, tag }
 *   "ns/name@version"       -> { id, version }       (explicit version pin)
 */
export interface BlueprintRef {
  id: BlueprintId;
  tag?: string;
  version?: string;
}

const REF_PATTERN = /^([a-z0-9-]+\/[a-z0-9-]+)(?:([:@])([A-Za-z0-9._-]+))?$/;

export function parseBlueprintRef(input: string): BlueprintRef {
  const m = REF_PATTERN.exec(input.trim());
  if (!m) throw new Error(`invalid blueprint ref: ${JSON.stringify(input)}`);
  const id = m[1] as BlueprintId;
  const sep = m[2];
  const rest = m[3];
  if (!sep) return { id };
  if (sep === ":") return { id, tag: rest };
  return { id, version: rest };
}

export function formatBlueprintRef(ref: BlueprintRef): string {
  if (ref.version) return `${ref.id}@${ref.version}`;
  if (ref.tag && ref.tag !== "latest") return `${ref.id}:${ref.tag}`;
  return ref.id;
}
