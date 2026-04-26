import { createRoute } from "@tanstack/react-router";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { useHealth, useStatus } from "@/api/queries.ts";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/",
  component: Overview,
});

function Overview(): React.JSX.Element {
  const health = useHealth();
  const status = useStatus();
  const s = status.data as
    | {
        uptime_ms?: number;
        deployments?: number;
        scheduled?: unknown[];
        queue?: { queued: number; running: number; failed: number };
        max_workers?: number;
      }
    | undefined;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">Live view of the running Oddjob server.</p>
        </div>
        <Badge className={health.data?.ok ? "bg-green-500/15 text-green-700" : "bg-muted"}>
          {health.data?.ok ? "healthy" : health.isLoading ? "..." : "down"}
        </Badge>
      </header>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Stat label="Uptime" value={fmtUptime(s?.uptime_ms)} />
        <Stat label="Deployments" value={String(s?.deployments ?? 0)} />
        <Stat label="Scheduled" value={String(s?.scheduled?.length ?? 0)} />
        <Stat label="Workers" value={String(s?.max_workers ?? 0)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Queue</CardTitle>
          <CardDescription>Live counts from the SQLite queue.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4">
          <Stat label="Queued" value={String(s?.queue?.queued ?? 0)} />
          <Stat label="Running" value={String(s?.queue?.running ?? 0)} />
          <Stat label="Failed" value={String(s?.queue?.failed ?? 0)} />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function fmtUptime(ms: number | undefined): string {
  if (!ms) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
