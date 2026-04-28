import type { ComponentType } from "react";

export interface Frontmatter {
  title: string;
  description?: string;
  group?: string;
  order?: number;
}

export interface Doc {
  slug: string;
  path: string;
  frontmatter: Frontmatter;
  Component: ComponentType;
}

export interface NavGroup {
  group: string;
  items: Doc[];
}
