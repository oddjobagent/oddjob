import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "../../lib/utils.ts";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium",
    "transition-[background-color,border-color,color,opacity] duration-(--duration-fast) ease-(--ease-out)",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-(--accent-9) text-(--accent-fg) hover:bg-(--accent-10)",
        secondary: "bg-(--surface-2) text-(--text) hover:bg-(--gray-4)",
        subtle: "bg-(--surface-2) text-(--text) hover:bg-(--gray-4)",
        outline:
          "border border-(--border-subtle) bg-transparent text-(--text) hover:bg-(--surface-2) hover:border-(--border)",
        ghost: "text-(--text) hover:bg-(--surface-2)",
        destructive: "bg-(--danger-9) text-(--accent-fg) hover:opacity-90",
        link: "h-auto px-0 text-(--accent-9) underline-offset-2 hover:underline",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5 text-xs",
        lg: "h-9 px-4",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  children?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled ?? loading}
      data-loading={loading ? "" : undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export { buttonVariants };
