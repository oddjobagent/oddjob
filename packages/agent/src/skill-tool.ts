import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type, type TSchema } from "typebox";

import type { LoadedSkill, LogEntry } from "@oddjob/core";

export interface SkillToolOptions {
  skills: LoadedSkill[];
  onLog?: (entry: LogEntry) => void;
}

const InputSchema = Type.Object({
  name: Type.String({ description: "Skill name to load (must be one of the listed skills)" }),
});

export function buildSkillTool(opts: SkillToolOptions): AgentTool<TSchema> | null {
  if (opts.skills.length === 0) return null;
  const byName = new Map(opts.skills.map((s) => [s.name, s] as const));
  const names = [...byName.keys()].join(", ");
  return {
    name: "skill_load",
    label: "skill_load",
    description: `Load the full instructions for a skill. Available skills: ${names}.`,
    parameters: InputSchema,
    async execute(_id, params): Promise<AgentToolResult<{ skill: string }>> {
      const name = (params as { name: string }).name;
      const skill = byName.get(name);
      if (!skill) {
        return {
          content: [{ type: "text", text: `unknown skill: ${name}. Available: ${names}` }],
          details: { skill: name },
          terminate: false,
        };
      }
      opts.onLog?.({
        timestamp: Date.now(),
        level: "info",
        message: `loaded skill ${name}`,
      });
      return {
        content: [{ type: "text", text: skill.body }],
        details: { skill: name },
      };
    },
  };
}

export function buildSkillSystemPrompt(skills: LoadedSkill[]): string {
  if (skills.length === 0) return "";
  const lines = ["", "Skills available (call the `skill_load` tool to expand):"];
  for (const s of skills) {
    lines.push(`- ${s.name}: ${s.description}`);
  }
  return lines.join("\n");
}
