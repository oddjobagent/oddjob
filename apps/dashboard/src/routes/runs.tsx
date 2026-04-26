import { createRoute, Link } from "@tanstack/react-router";

import { Card } from "../components/ui/card.tsx";
import { RunStatusBadge } from "../components/runs/RunStatusBadge.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import { useRuns } from "../api/queries.ts";
import { formatCost, formatRelative } from "../lib/format.ts";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/runs",
  component: Runs,
});

function Runs(): React.JSX.Element {
  const { data, isLoading } = useRuns({ limit: 100 });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
        <p className="text-sm text-muted-foreground">
          All recent agent runs across all deployments.
        </p>
      </header>

      <Card>
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
            {isLoading && (
              <>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              </>
            )}
            {data?.runs.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No runs yet. Trigger a deployment to see one here.
                </TableCell>
              </TableRow>
            )}
            {data?.runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  <RunStatusBadge status={run.status} />
                </TableCell>
                <TableCell>
                  <Link
                    to="/runs/$id"
                    params={{ id: run.id }}
                    className="font-mono text-xs hover:underline"
                  >
                    {run.id.slice(0, 8)}
                  </Link>
                  <div className="text-xs text-muted-foreground">{run.blueprintId}</div>
                </TableCell>
                <TableCell className="text-sm">{run.triggeredBy}</TableCell>
                <TableCell className="text-sm tabular-nums">
                  {run.tokenInput.toLocaleString()} / {run.tokenOutput.toLocaleString()}
                </TableCell>
                <TableCell className="text-sm tabular-nums">{formatCost(run.costUsd)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatRelative(run.startedAt ?? run.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
