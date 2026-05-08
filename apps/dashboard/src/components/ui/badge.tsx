import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils.ts";

const badgeVariants = cva(
  "inline-flex items-center rounded-md font-medium tracking-(--tracking-snug)",
  {
    variants: {
      tone: {
        default: "bg-(--surface-2) text-(--text-muted) border border-(--border-subtle)",
        accent: "bg-(--accent-3) text-(--accent-9) border border-(--accent-7)/40",
        success: "bg-(--success-3) text-(--success-9) border border-(--success-7)/40",
        warn: "bg-(--warn-3) text-(--warn-9) border border-(--warn-7)/40",
        danger: "bg-(--danger-3) text-(--danger-9) border border-(--danger-7)/40",
        info: "bg-(--info-3) text-(--info-9) border border-(--info-7)/40",
        outline: "border border-(--border) text-(--text-muted)",
      },
      size: {
        default: "h-6 px-2 text-[11px]",
        sm: "h-5 px-1.5 text-[10px]",
        lg: "h-7 px-2.5 text-xs",
      },
    },
    defaultVariants: { tone: "default", size: "default" },
  },
);

export interface BadgeProps
  extends
    Omit<React.HTMLAttributes<HTMLSpanElement>, "color">,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps): React.JSX.Element {
  return <span className={cn(badgeVariants({ tone, size, className }))} {...props} />;
}

export { badgeVariants };
