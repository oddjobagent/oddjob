import type { ComponentType } from "react";
import type { Doc, Frontmatter, NavGroup } from "./types.ts";

interface MdxModule {
  default: ComponentType;
  frontmatter?: Frontmatter;
}

const modules = import.meta.glob<MdxModule>("@docs/**/*.{md,mdx}", {
  eager: true,
});

function deriveTitle(slug: string): string {
  const last = slug.split("/").pop() ?? slug;
  return last.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function deriveGroup(slug: string): string {
  const parts = slug.split("/");
  return parts.length > 1 ? (parts[0] ?? "") : "";
}

export const docs: Doc[] = Object.entries(modules)
  .map(([file, mod]) => {
    const slug = file
      .replace(/^.*\/docs\//, "")
      .replace(/\.mdx?$/, "")
      .toLowerCase();
    const fm: Frontmatter = mod.frontmatter ?? { title: deriveTitle(slug) };
    return {
      slug,
      path: file,
      frontmatter: {
        ...fm,
        title: fm.title || deriveTitle(slug),
        group: fm.group ?? deriveGroup(slug),
      },
      Component: mod.default,
    };
  })
  .toSorted((a, b) => {
    const ag = a.frontmatter.group ?? "";
    const bg = b.frontmatter.group ?? "";
    if (ag !== bg) return ag.localeCompare(bg);
    const ao = a.frontmatter.order ?? 999;
    const bo = b.frontmatter.order ?? 999;
    if (ao !== bo) return ao - bo;
    return a.frontmatter.title.localeCompare(b.frontmatter.title);
  });

export const docBySlug: ReadonlyMap<string, Doc> = new Map(docs.map((d) => [d.slug, d]));

export function buildNav(): NavGroup[] {
  const map = new Map<string, Doc[]>();
  for (const d of docs) {
    const g = d.frontmatter.group ?? "";
    const arr = map.get(g);
    if (arr) arr.push(d);
    else map.set(g, [d]);
  }
  return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
}
