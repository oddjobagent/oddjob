import * as React from "react";

import { cn } from "../../lib/utils.ts";

export function Toolbar({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 [&_>_:not(:last-child).toolbar-group]:after:mx-2 [&_>_:not(:last-child).toolbar-group]:after:h-4 [&_>_:not(:last-child).toolbar-group]:after:w-px [&_>_:not(:last-child).toolbar-group]:after:bg-(--border-subtle) [&_>_:not(:last-child).toolbar-group]:after:content-['']",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function Group({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div className={cn("toolbar-group flex items-center gap-1", className)} {...props}>
      {children}
    </div>
  );
}

Toolbar.Group = Group;
