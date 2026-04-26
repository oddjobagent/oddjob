import type { Run } from "@oddjob/core";

import { Badge } from "../ui/badge.tsx";
import { statusVisual } from "../../lib/status.ts";

export function RunStatusBadge({ status }: { status: Run["status"] }): React.JSX.Element {
  const v = statusVisual(status);
  return <Badge className={v.className}>{v.label}</Badge>;
}
