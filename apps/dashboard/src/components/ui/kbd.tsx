import * as React from "react";

import { cn } from "../../lib/utils.ts";

export function Kbd({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement>): React.JSX.Element {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-(--border-subtle) bg-(--surface-2) px-1 font-mono text-[10px] font-medium text-(--text-muted)",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}
