import * as React from "react";

import { cn } from "../../lib/utils.ts";

interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  trend?: "up" | "down" | "flat";
}

export function Stat({
  label,
  value,
  hint,
  trend,
  className,
  ...props
}: StatProps): React.JSX.Element {
  return (
    <div className={cn("flex flex-col gap-1", className)} {...props}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-(--text-muted)">
        {label}
      </div>
      <div
        className={cn(
          "text-xl font-semibold tabular-nums tracking-(--tracking-tight) text-(--text)",
          trend === "up" && "text-(--success-9)",
          trend === "down" && "text-(--danger-9)",
        )}
      >
        {value}
      </div>
      {hint ? <div className="text-xs text-(--text-muted)">{hint}</div> : null}
    </div>
  );
}

export function StatGroup({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 lg:grid-cols-4 [&>*+*]:border-l [&>*+*]:border-(--border-subtle) [&>*+*]:pl-6",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
