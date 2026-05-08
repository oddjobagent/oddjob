import * as React from "react";
import { Copy } from "lucide-react";

import { cn } from "../../lib/utils.ts";

interface KeyValueProps {
  k: React.ReactNode;
  v: React.ReactNode;
  mono?: boolean;
  copy?: string;
  className?: string;
}

export function KeyValue({ k, v, mono, copy, className }: KeyValueProps): React.JSX.Element {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", className)}>
      <span className="font-medium uppercase tracking-wide text-(--text-muted)">{k}</span>
      <span className={cn("text-(--text) tabular-nums", mono && "font-mono")}>{v}</span>
      {copy ? (
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(copy)}
          className="text-(--text-subtle) hover:text-(--text)"
          aria-label="Copy"
        >
          <Copy className="size-3" />
        </button>
      ) : null}
    </span>
  );
}
