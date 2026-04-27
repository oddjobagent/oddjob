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
      <label className="text-sm font-medium leading-none flex items-center gap-1">
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {helper && !error && <p className="text-xs text-muted-foreground">{helper}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
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
    <fieldset className={cn("rounded-lg border p-4 space-y-4", className)}>
      {legend && <legend className="px-1 text-sm font-semibold text-foreground">{legend}</legend>}
      {children}
    </fieldset>
  );
}
