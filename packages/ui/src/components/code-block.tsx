import * as React from "react";
import { cn } from "../lib/cn.ts";

export interface CodeBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  language?: string;
}

export const CodeBlock = React.forwardRef<HTMLPreElement, CodeBlockProps>(function CodeBlock(
  { className, language, children, ...props },
  ref,
) {
  return (
    <pre
      ref={ref}
      data-language={language}
      className={cn(
        "overflow-x-auto rounded-lg border border-border bg-card p-4 text-sm leading-relaxed text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </pre>
  );
});

export function InlineCode({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <code
      className={cn("rounded bg-muted px-1.5 py-0.5 text-[0.9em] text-foreground", className)}
      {...props}
    />
  );
}
