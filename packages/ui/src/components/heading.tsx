import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.ts";

const headingVariants = cva("font-semibold tracking-tight text-foreground", {
  variants: {
    size: {
      h1: "text-5xl sm:text-6xl lg:text-7xl leading-[1.05]",
      h2: "text-3xl sm:text-4xl lg:text-5xl leading-[1.1]",
      h3: "text-2xl sm:text-3xl leading-tight",
      h4: "text-xl leading-tight",
      eyebrow: "text-xs uppercase tracking-[0.18em] font-mono text-muted-foreground",
    },
  },
  defaultVariants: { size: "h2" },
});

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span";

export interface HeadingProps
  extends React.HTMLAttributes<HTMLHeadingElement>, VariantProps<typeof headingVariants> {
  as?: HeadingTag;
}

export const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(function Heading(
  { className, size, as: As = "h2", ...props },
  ref,
) {
  return (
    <As
      ref={ref as React.Ref<HTMLHeadingElement>}
      className={cn(headingVariants({ size, className }))}
      {...props}
    />
  );
});
