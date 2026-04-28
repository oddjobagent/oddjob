import { createFileRoute, notFound } from "@tanstack/react-router";
import { MDXProvider } from "@mdx-js/react";
import { Heading } from "@oddjob/ui";
import { docBySlug } from "~/docs/docs-loader.ts";
import { mdxComponents } from "~/components/mdx/mdx-components.tsx";

export const Route = createFileRoute("/docs/$")({
  loader: ({ params }) => {
    const slug = params._splat ?? "";
    const doc = docBySlug.get(slug);
    if (!doc) throw notFound();
    return { slug, frontmatter: doc.frontmatter };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.frontmatter.title} · Oddjob` },
          ...(loaderData.frontmatter.description
            ? [
                {
                  name: "description",
                  content: loaderData.frontmatter.description,
                },
              ]
            : []),
        ]
      : [],
  }),
  component: DocPage,
});

function DocPage() {
  const { slug } = Route.useLoaderData();
  const doc = docBySlug.get(slug);
  if (!doc) return null;
  const { Component, frontmatter } = doc;
  return (
    <article>
      {frontmatter.group ? (
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {frontmatter.group}
        </p>
      ) : null}
      <Heading as="h1" size="h3" className="mb-3">
        {frontmatter.title}
      </Heading>
      {frontmatter.description ? (
        <p className="mb-10 text-lg text-muted-foreground leading-relaxed">
          {frontmatter.description}
        </p>
      ) : null}
      <div className="prose-content">
        <MDXProvider components={mdxComponents}>
          <Component />
        </MDXProvider>
      </div>
    </article>
  );
}
