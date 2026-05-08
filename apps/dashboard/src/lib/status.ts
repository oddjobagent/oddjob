import type { Run } from "@oddjob/core";

import type { BadgeProps } from "../components/ui/badge.tsx";

export interface StatusVisual {
  label: string;
  tone: NonNullable<BadgeProps["tone"]>;
}

export function statusVisual(status: Run["status"]): StatusVisual {
  switch (status) {
    case "queued":
      return { label: "queued", tone: "default" };
    case "running":
      return { label: "running", tone: "info" };
    case "complete":
      return { label: "complete", tone: "success" };
    case "failed":
      return { label: "failed", tone: "danger" };
    case "timeout":
      return { label: "timeout", tone: "warn" };
    case "cancelled":
      return { label: "cancelled", tone: "default" };
    default:
      return { label: String(status), tone: "default" };
  }
}
