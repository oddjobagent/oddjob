import * as React from "react";

import { cn } from "../../lib/utils.ts";

interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  tabs?: React.ReactNode;
}

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  tabs,
  className,
  ...props
}: PageHeaderProps): React.JSX.Element {
  return (
    <header
      className={cn("mb-6 flex flex-col gap-3 border-b border-(--border-subtle) pb-4", className)}
      {...props}
    >
      {eyebrow ? (
        <div className="text-xs text-(--text-muted) flex items-center gap-1.5">{eyebrow}</div>
      ) : null}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-(--tracking-tight) text-(--text)">
            {title}
          </h1>
          {description ? <p className="mt-1 text-sm text-(--text-muted)">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {tabs ? <div className="-mb-4">{tabs}</div> : null}
    </header>
  );
}
