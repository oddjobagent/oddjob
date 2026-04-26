import type { Connector } from "./connector.ts";
import type { Skill } from "./skill.ts";

export interface Blueprint {
  name: string;
  namespace: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  license: string;
  model: string;
  prompt: string;
  tools: string[];
  skills: string[];
  connectors: Record<string, Connector>;
  scripts: Record<string, string>;
  memory: BlueprintMemory;
  secrets: Record<string, string>;
  outputSchema?: BlueprintOutputSchema;
  path: string;
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

export type BlueprintId = `${string}/${string}`;
