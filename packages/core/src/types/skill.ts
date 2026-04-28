export interface Skill {
  name: string;
  description: string;
  path: string;
  body: string;
  metadata: Record<string, unknown>;
  source?: SkillSource;
}

export interface SkillSource {
  kind: "github" | "git" | "local";
  reference: string;
  commit?: string;
  pulledAt: number;
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  [key: string]: unknown;
}

export interface LoadedSkill extends Skill {
  blueprintLocal: boolean;
}
