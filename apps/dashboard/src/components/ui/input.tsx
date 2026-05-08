import * as React from "react";

import { cn } from "../../lib/utils.ts";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      "flex h-8 w-full rounded-md border border-(--border) bg-(--surface-raised) px-2.5 text-sm text-(--text)",
      "transition-[border-color,box-shadow] duration-(--duration-fast)",
      "placeholder:text-(--text-subtle)",
      "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-(--text)",
      "focus-visible:outline-none focus-visible:border-(--accent-9) focus-visible:ring-2 focus-visible:ring-(--accent-9)/20",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
