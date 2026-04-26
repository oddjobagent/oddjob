import { createRoute, Link } from "@tanstack/react-router";

import { Card } from "../components/ui/card.tsx";
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
  const { data, isLoading } = useDeployments();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Deployments</h1>
        <p className="text-sm text-muted-foreground">
          Running blueprints with their triggers and channels.
        </p>
      </header>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Blueprint</TableHead>
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
                    <TableCell colSpan={6}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              </>
            )}
            {data?.deployments.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No deployments yet. Use <code className="font-mono">oddjob deploy</code> to create
                  one.
                </TableCell>
              </TableRow>
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
                <TableCell className="text-sm">
                  {d.triggers.map((t) => t.type).join(", ")}
                </TableCell>
                <TableCell className="text-sm">
                  {d.channels.length === 0 ? "—" : d.channels.map((c) => c.type).join(", ")}
                </TableCell>
                <TableCell>
                  <Badge
                    className={
                      d.status === "active" ? "bg-green-500/15 text-green-600" : "bg-muted"
                    }
                  >
                    {d.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatRelative(d.updatedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
