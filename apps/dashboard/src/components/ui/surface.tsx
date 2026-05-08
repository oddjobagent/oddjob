import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils.ts";

const surfaceVariants = cva("rounded-md border", {
  variants: {
    variant: {
      flat: "border-(--border-subtle) bg-(--surface-1)",
      raised: "border-(--border-subtle) bg-(--surface-raised) shadow-sm shadow-(--gray-12)/[0.03]",
      ghost: "border-transparent bg-transparent",
    },
    tone: {
      default: "",
      accent: "border-(--accent-7)/40 bg-(--accent-3)/40",
      success: "border-(--success-7)/40 bg-(--success-3)/40",
      warn: "border-(--warn-7)/40 bg-(--warn-3)/40",
      danger: "border-(--danger-7)/40 bg-(--danger-3)/40",
      info: "border-(--info-7)/40 bg-(--info-3)/40",
    },
    padding: {
      none: "p-0",
      sm: "p-3",
      md: "p-4",
      lg: "p-6",
    },
  },
  defaultVariants: { variant: "flat", tone: "default", padding: "md" },
});

export interface SurfaceProps
  extends
    Omit<React.HTMLAttributes<HTMLDivElement>, "color">,
    VariantProps<typeof surfaceVariants> {}

export const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, variant, tone, padding, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(surfaceVariants({ variant, tone, padding, className }))}
      {...props}
    />
  ),
);
Surface.displayName = "Surface";

export { surfaceVariants };
