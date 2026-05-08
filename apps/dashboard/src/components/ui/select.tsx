import * as React from "react";

import { cn } from "../../lib/utils.ts";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-8 w-full rounded-md border border-(--border) bg-(--surface-raised) px-2.5 text-sm text-(--text)",
        "transition-[border-color,box-shadow] duration-(--duration-fast)",
        "focus-visible:outline-none focus-visible:border-(--accent-9) focus-visible:ring-2 focus-visible:ring-(--accent-9)/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";
