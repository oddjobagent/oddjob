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
  model: string;
  prompt: string;
  /**
   * Allowlist of built-in harness tools the blueprint opts into
   * (`bash`, `read`, `write`, `edit`, `grep`, `find`, `ls`,
   * `web_fetch`, `web_search`, `python_repl`, `javascript_repl`).
   * Empty / omitted = no built-ins. Unknown names fail validation.
   */
  tools: string[];
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
}

export type BlueprintId = `${string}/${string}`;
