import * as React from "react";

import { cn } from "../../lib/utils.ts";

interface SectionProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

export function Section({
  title,
  description,
  actions,
  className,
  children,
  ...props
}: SectionProps): React.JSX.Element {
  return (
    <section className={cn("space-y-3", className)} {...props}>
      {(title || actions || description) && (
        <div className="flex items-end justify-between gap-3">
          <div>
            {title ? (
              <h2 className="text-sm font-semibold tracking-(--tracking-snug) text-(--text)">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-xs text-(--text-muted)">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}
