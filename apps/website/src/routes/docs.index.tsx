import { createFileRoute, Link } from "@tanstack/react-router";
import { Heading } from "@oddjob/ui";
import { buildNav } from "~/docs/docs-loader.ts";

export const Route = createFileRoute("/docs/")({
  component: DocsIndex,
  head: () => ({
    meta: [{ title: "Docs · Oddjob" }],
  }),
});

function DocsIndex() {
  const nav = buildNav();
  return (
    <article>
      <Heading as="h1" size="h2" className="mb-4">
        Documentation
      </Heading>
      <p className="mb-10 text-lg text-muted-foreground leading-relaxed">
        Everything you need to author, deploy, and operate Oddjob agents.
      </p>
      <div className="flex flex-col gap-8">
        {nav.map(({ group, items }) => (
          <section key={group || "_root"}>
            <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {group || "overview"}
            </h2>
            <ul className="flex flex-col gap-2">
              {items.map((d) => (
                <li key={d.slug}>
                  <Link
                    to="/docs/$"
                    params={{ _splat: d.slug }}
                    className="group flex flex-col gap-1 rounded-lg border border-border bg-card p-4 hover:border-primary/40 transition-colors"
                  >
                    <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                      {d.frontmatter.title}
                    </span>
                    {d.frontmatter.description ? (
                      <span className="text-sm text-muted-foreground">
                        {d.frontmatter.description}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}
