import { createRoute, Link } from "@tanstack/react-router";

import { Card } from "../components/ui/card.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import { useBlueprints } from "../api/queries.ts";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/blueprints",
  component: Blueprints,
});

function Blueprints(): React.JSX.Element {
  const { data, isLoading } = useBlueprints();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Blueprints</h1>
        <p className="text-sm text-muted-foreground">Pushed agent definitions.</p>
      </header>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Hash</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <>
                {Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              </>
            )}
            {data?.blueprints.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No blueprints yet. Use <code className="font-mono">oddjob push</code> to upload
                  one.
                </TableCell>
              </TableRow>
            )}
            {data?.blueprints.map((bp) => (
              <TableRow key={bp.id}>
                <TableCell>
                  <Link
                    to="/blueprints/$namespace/$name"
                    params={{ namespace: bp.namespace, name: bp.name }}
                    className="font-medium hover:underline"
                  >
                    {bp.id}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">{bp.version}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{bp.description}</TableCell>
                <TableCell className="text-xs font-mono text-muted-foreground">
                  {bp.contentHash.slice(0, 8)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
