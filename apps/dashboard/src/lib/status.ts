import type { Run } from "@oddjob/core";

export interface StatusVisual {
  label: string;
  className: string;
}

export function statusVisual(status: Run["status"]): StatusVisual {
  switch (status) {
    case "queued":
      return { label: "queued", className: "bg-muted text-muted-foreground" };
    case "running":
      return { label: "running", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400" };
    case "complete":
      return { label: "complete", className: "bg-green-500/15 text-green-600 dark:text-green-400" };
    case "failed":
      return { label: "failed", className: "bg-red-500/15 text-red-600 dark:text-red-400" };
    case "timeout":
      return { label: "timeout", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" };
    case "cancelled":
      return { label: "cancelled", className: "bg-muted text-muted-foreground line-through" };
    default:
      return { label: String(status), className: "bg-muted text-muted-foreground" };
  }
}
