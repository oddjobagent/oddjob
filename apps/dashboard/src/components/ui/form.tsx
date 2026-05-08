import * as React from "react";

import { cn } from "../../lib/utils.ts";

export function Field({
  label,
  helper,
  error,
  required,
  children,
  className,
}: {
  label: React.ReactNode;
  helper?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="flex items-center gap-1 text-xs font-medium text-(--text-muted)">
        {label}
        {required && (
          <span className="text-(--danger-9)" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {helper && !error && <p className="text-xs text-(--text-subtle)">{helper}</p>}
      {error && <p className="text-xs text-(--danger-9)">{error}</p>}
    </div>
  );
}

export function Fieldset({
  legend,
  children,
  className,
}: {
  legend?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <fieldset
      className={cn(
        "rounded-md border border-(--border-subtle) bg-(--surface-1) p-4 space-y-4",
        className,
      )}
    >
      {legend && <legend className="px-1 text-sm font-semibold text-(--text)">{legend}</legend>}
      {children}
    </fieldset>
  );
}
