import * as React from "react";

import type { EnvironmentTrustTier } from "@oddjob/api-client";

import { Badge } from "../ui/badge.tsx";

const STYLE: Record<EnvironmentTrustTier, { className: string; label: string; help: string }> = {
  trusted: {
    className: "bg-red-500/15 text-red-700",
    label: "trusted",
    help: "Runs on the host with full access. Dev only.",
  },
  "local-strict": {
    className: "bg-emerald-500/15 text-emerald-700",
    label: "local-strict",
    help: "OS sandbox (seatbelt / bwrap / appcontainer) — workdir-only FS, egress via proxy.",
  },
  container: {
    className: "bg-blue-500/15 text-blue-700",
    label: "container",
    help: "Container per run — image-based, isolated network namespace.",
  },
  "remote-vm": {
    className: "bg-purple-500/15 text-purple-700",
    label: "remote-vm",
    help: "Remote VM (Daytona / Firecracker / etc) — fullest isolation.",
  },
};

export function TrustTierBadge({ tier }: { tier: EnvironmentTrustTier }): React.JSX.Element {
  const s = STYLE[tier];
  return (
    <Badge className={s.className} title={s.help}>
      {s.label}
    </Badge>
  );
}
