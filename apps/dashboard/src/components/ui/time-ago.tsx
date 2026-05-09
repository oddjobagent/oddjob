import * as React from "react";

import { formatDate, formatDateFull, formatDateIso } from "../../lib/format.ts";
import { cn } from "../../lib/utils.ts";

export interface TimeAgoProps extends Omit<React.TimeHTMLAttributes<HTMLTimeElement>, "title"> {
  /** Epoch ms or any Date.parse-able string. Null/undefined renders as em-dash. */
  value: number | string | null | undefined;
  /** Override the displayed string. Default: project-standard formatDate output. */
  display?: string;
}

/**
 * Project-wide time renderer. Renders relative-or-short via formatDate; native
 * browser tooltip on hover shows the unabbreviated absolute date+time. Wraps
 * `<time>` with `dateTime` for semantic correctness + screen-reader support.
 */
export function TimeAgo({ value, display, className, ...rest }: TimeAgoProps): React.JSX.Element {
  if (value === null || value === undefined) {
    return <span className={cn("text-(--text-muted)", className)}>—</span>;
  }
  return (
    <time
      dateTime={formatDateIso(value)}
      title={formatDateFull(value)}
      className={cn("cursor-help underline-offset-2 hover:decoration-dotted", className)}
      {...rest}
    >
      {display ?? formatDate(value)}
    </time>
  );
}
