import * as React from "react";

import { cn } from "../../lib/utils.ts";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-md border border-dashed border-(--border-subtle) bg-(--surface-1)/50 py-14 px-6 text-center",
        className,
      )}
    >
      {Icon && <Icon className="mb-3 size-5 text-(--text-subtle)" aria-hidden />}
      <h3 className="text-sm font-semibold text-(--text)">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-xs text-(--text-muted)">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
