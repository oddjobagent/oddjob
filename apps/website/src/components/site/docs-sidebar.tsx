import { Link } from "@tanstack/react-router";
import { cn } from "@oddjob/ui";
import { buildNav } from "~/docs/docs-loader.ts";

interface DocsSidebarProps {
  currentSlug?: string;
}

function formatGroup(g: string): string {
  if (!g) return "Overview";
  return g.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function DocsSidebar({ currentSlug }: DocsSidebarProps) {
  const nav = buildNav();
  return (
    <nav className="text-sm">
      <ul className="flex flex-col gap-6">
        {nav.map(({ group, items }) => (
          <li key={group || "_root"}>
            <p className="mb-2 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {formatGroup(group)}
            </p>
            <ul className="flex flex-col gap-1">
              {items.map((item) => {
                const active = item.slug === currentSlug;
                return (
                  <li key={item.slug}>
                    <Link
                      to="/docs/$"
                      params={{ _splat: item.slug }}
                      className={cn(
                        "block rounded px-2 py-1 transition-colors",
                        active
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-foreground/80 hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {item.frontmatter.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
