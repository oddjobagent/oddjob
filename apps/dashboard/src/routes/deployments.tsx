import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus, ServerCog } from "lucide-react";
import * as React from "react";

import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { EmptyState } from "../components/ui/empty-state.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Badge } from "../components/ui/badge.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import { useDeployments } from "../api/queries.ts";
import { formatRelative } from "../lib/format.ts";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/deployments",
  component: Deployments,
});

function Deployments(): React.JSX.Element {
  const [showArchived, setShowArchived] = React.useState(false);
  const navigate = useNavigate();
  const { data, isLoading } = useDeployments(showArchived);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Deployments</h1>
          <p className="text-sm text-muted-foreground">
            Running blueprints with their triggers and channels.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
          <Button onClick={() => navigate({ to: "/deployments/new" })}>
            <Plus className="size-4" /> New deployment
          </Button>
        </div>
      </header>

      {data?.deployments.length === 0 && !isLoading ? (
        <EmptyState
          icon={ServerCog}
          title="No deployments yet"
          description="Push a blueprint with the CLI, then create a deployment here."
          action={
            <Button onClick={() => navigate({ to: "/deployments/new" })}>
              <Plus className="size-4" /> Create one
            </Button>
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Blueprint</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Triggers</TableHead>
                <TableHead>Channels</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}
                </>
              )}
              {data?.deployments.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link
                      to="/deployments/$id"
                      params={{ id: d.id }}
                      className="font-medium hover:underline"
                    >
                      {d.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{d.blueprintId}</TableCell>
                  <TableCell className="text-sm font-mono text-xs">
                    {d.modelOverride ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {d.triggers.map((t) => t.type).join(", ")}
                  </TableCell>
                  <TableCell className="text-sm">
                    {d.channels.length === 0 ? "—" : d.channels.map((c) => c.type).join(", ")}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={d.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRelative(d.updatedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const cls =
    status === "active"
      ? "bg-emerald-500/15 text-emerald-600"
      : status === "paused"
      ? "bg-amber-500/15 text-amber-700"
      : status === "archived"
      ? "bg-muted text-muted-foreground"
      : status === "disabled"
      ? "bg-destructive/10 text-destructive"
      : "bg-muted";
  return <Badge className={cls}>{status}</Badge>;
}
