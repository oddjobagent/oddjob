import { createRoute, useNavigate } from "@tanstack/react-router";
import { Plus, ServerCog } from "lucide-react";
import * as React from "react";

import { useDeployments } from "../api/queries.ts";
import { PageContainer } from "../components/layout/PageContainer.tsx";
import { Badge, type BadgeProps } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { EmptyState } from "../components/ui/empty-state.tsx";
import { PageHeader } from "../components/ui/page-header.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowLink,
} from "../components/ui/table.tsx";
import { Toolbar } from "../components/ui/toolbar.tsx";
import { TimeAgo } from "../components/ui/time-ago.tsx";

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
  const deployments = data?.deployments ?? [];

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        title="Deployments"
        description="Running blueprints with their triggers and channels."
        actions={
          <Button onClick={() => navigate({ to: "/deployments/new" })}>
            <Plus className="size-4" /> New deployment
          </Button>
        }
      />

      <Toolbar>
        <Toolbar.Group>
          <label className="flex items-center gap-2 text-xs text-(--text-muted)">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="size-3.5 accent-(--accent-9)"
            />
            Show archived
          </label>
        </Toolbar.Group>
      </Toolbar>

      {isLoading ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Blueprint</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Triggers</TableHead>
              <TableHead>Channels</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={7}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : deployments.length === 0 ? (
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Blueprint</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Triggers</TableHead>
              <TableHead>Channels</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deployments.map((d) => (
              <TableRowLink key={d.id} to="/deployments/$id" params={{ id: d.id }}>
                <TableCell>
                  <span className="text-sm font-medium text-(--text)">{d.name}</span>
                </TableCell>
                <TableCell className="font-mono text-xs text-(--text-muted)">
                  {d.blueprintId}
                </TableCell>
                <TableCell className="font-mono text-xs text-(--text-muted)">
                  {d.modelOverride ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-(--text-muted)">
                  {d.triggers.map((t) => t.type).join(", ") || "—"}
                </TableCell>
                <TableCell className="text-xs text-(--text-muted)">
                  {d.channels.length === 0 ? "—" : d.channels.map((c) => c.type).join(", ")}
                </TableCell>
                <TableCell>
                  <StatusBadge status={d.status} />
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums text-(--text-muted)">
                  <TimeAgo value={d.updatedAt} />
                </TableCell>
              </TableRowLink>
            ))}
          </TableBody>
        </Table>
      )}
    </PageContainer>
  );
}

export function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const tone: BadgeProps["tone"] =
    status === "active"
      ? "success"
      : status === "paused"
        ? "warn"
        : status === "disabled"
          ? "danger"
          : "default";
  return (
    <Badge tone={tone} size="sm">
      {status}
    </Badge>
  );
}
