import type { Run } from "@oddjob/core";

import { Badge } from "../ui/badge.tsx";
import { statusVisual } from "../../lib/status.ts";

export function RunStatusBadge({
  status,
  size,
}: {
  status: Run["status"];
  size?: "sm" | "default" | "lg";
}): React.JSX.Element {
  const v = statusVisual(status);
  return (
    <Badge tone={v.tone} size={size}>
      {v.label}
    </Badge>
  );
}
