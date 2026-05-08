import { createRoute, Link } from "@tanstack/react-router";
import { Activity } from "lucide-react";

import { useRuns } from "../api/queries.ts";
import { PageContainer } from "../components/layout/PageContainer.tsx";
import { RunStatusBadge } from "../components/runs/RunStatusBadge.tsx";
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
} from "../components/ui/table.tsx";
import { formatCost, formatRelative } from "../lib/format.ts";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/runs",
  component: Runs,
});

function Runs(): React.JSX.Element {
  const { data, isLoading } = useRuns({ limit: 100 });
  const runs = data?.runs ?? [];

  return (
    <PageContainer className="space-y-6">
      <PageHeader title="Runs" description="All recent agent runs across all deployments." />

      {isLoading ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Run</TableHead>
              <TableHead>Triggered by</TableHead>
              <TableHead>Tokens (in / out)</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={6}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : runs.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No runs yet"
          description="Runs appear here once a deployment is triggered."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead>Run</TableHead>
              <TableHead>Triggered by</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  <RunStatusBadge status={run.status} size="sm" />
                </TableCell>
                <TableCell>
                  <Link
                    to="/runs/$id"
                    params={{ id: run.id }}
                    className="font-mono text-xs text-(--accent-9) hover:underline"
                  >
                    {run.id.slice(0, 8)}
                  </Link>
                  <div className="font-mono text-[11px] text-(--text-muted)">{run.blueprintId}</div>
                </TableCell>
                <TableCell className="text-sm text-(--text-muted)">{run.triggeredBy}</TableCell>
                <TableCell className="text-right text-sm tabular-nums text-(--text-muted)">
                  {run.tokenInput.toLocaleString()} / {run.tokenOutput.toLocaleString()}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {formatCost(run.costUsd)}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums text-(--text-muted)">
                  {formatRelative(run.startedAt ?? run.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </PageContainer>
  );
}
