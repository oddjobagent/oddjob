import * as React from "react";
import type { MDXComponents } from "mdx/types";
import { cn } from "@oddjob/ui";

function H1(props: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h1
      {...props}
      className={cn(
        "scroll-mt-24 mt-0 mb-6 text-3xl sm:text-4xl font-semibold tracking-tight",
        props.className,
      )}
    />
  );
}

function H2(props: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      {...props}
      className={cn(
        "scroll-mt-24 mt-12 mb-4 text-2xl font-semibold tracking-tight",
        props.className,
      )}
    />
  );
}

function H3(props: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      {...props}
      className={cn("scroll-mt-24 mt-8 mb-3 text-lg font-semibold", props.className)}
    />
  );
}

function P(props: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      {...props}
      className={cn("leading-7 text-foreground/90 [&:not(:first-child)]:mt-4", props.className)}
    />
  );
}

function Ul(props: React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      {...props}
      className={cn("my-4 ml-6 list-disc text-foreground/90 [&>li]:mt-1", props.className)}
    />
  );
}

function Ol(props: React.HTMLAttributes<HTMLOListElement>) {
  return (
    <ol
      {...props}
      className={cn("my-4 ml-6 list-decimal text-foreground/90 [&>li]:mt-1", props.className)}
    />
  );
}

function A(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      className={cn("text-primary underline-offset-4 hover:underline", props.className)}
    />
  );
}

function InlineCode(props: React.HTMLAttributes<HTMLElement>) {
  return (
    <code
      {...props}
      className={cn("rounded bg-muted px-1.5 py-0.5 text-[0.9em] font-mono", props.className)}
    />
  );
}

function Pre(props: React.HTMLAttributes<HTMLPreElement>) {
  return (
    <pre
      {...props}
      className={cn(
        "my-6 overflow-x-auto rounded-lg border border-border bg-card p-4 text-sm leading-relaxed [&_code]:font-mono",
        props.className,
      )}
    />
  );
}

function Blockquote(props: React.HTMLAttributes<HTMLQuoteElement>) {
  return (
    <blockquote
      {...props}
      className={cn(
        "my-6 border-l-2 border-primary pl-4 italic text-muted-foreground",
        props.className,
      )}
    />
  );
}

function Table(props: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="my-6 overflow-x-auto rounded-lg border border-border">
      <table {...props} className={cn("w-full text-sm", props.className)} />
    </div>
  );
}

function Th(props: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...props}
      className={cn(
        "border-b border-border bg-muted/50 px-4 py-2 text-left font-semibold",
        props.className,
      )}
    />
  );
}

function Td(props: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      {...props}
      className={cn("border-b border-border/50 px-4 py-2 align-top", props.className)}
    />
  );
}

function Hr(props: React.HTMLAttributes<HTMLHRElement>) {
  return <hr {...props} className={cn("my-10 border-border", props.className)} />;
}

export const mdxComponents: MDXComponents = {
  h1: H1,
  h2: H2,
  h3: H3,
  p: P,
  ul: Ul,
  ol: Ol,
  a: A,
  code: InlineCode,
  pre: Pre,
  blockquote: Blockquote,
  table: Table,
  th: Th,
  td: Td,
  hr: Hr,
};
