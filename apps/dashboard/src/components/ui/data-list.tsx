import * as React from "react";

import { cn } from "../../lib/utils.ts";

export function DataList({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDListElement>): React.JSX.Element {
  return (
    <dl
      className={cn("grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm", className)}
      {...props}
    >
      {children}
    </dl>
  );
}

interface ItemProps {
  label: React.ReactNode;
  children: React.ReactNode;
  mono?: boolean;
  className?: string;
}

function Item({ label, children, mono, className }: ItemProps): React.JSX.Element {
  return (
    <>
      <dt className="text-xs font-medium uppercase tracking-wide text-(--text-muted)">{label}</dt>
      <dd
        className={cn(
          "text-sm text-(--text) tabular-nums",
          mono && "font-mono text-[13px]",
          className,
        )}
      >
        {children}
      </dd>
    </>
  );
}

DataList.Item = Item;
