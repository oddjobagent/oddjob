import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";

import { api } from "../api/client.ts";
import { useDeployment, useRuns } from "../api/queries.ts";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { RunStatusBadge } from "../components/runs/RunStatusBadge.tsx";
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
  path: "/deployments/$id",
  component: DeploymentDetail,
});

function DeploymentDetail(): React.JSX.Element {
  const { id } = Route.useParams();
  const dep = useDeployment(id);
  const recent = useRuns({ deploymentId: id, limit: 25 });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const trigger = useMutation({
    mutationFn: () => api.deployments.trigger(id),
    onSuccess: ({ run_id }) => {
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void navigate({ to: "/runs/$id", params: { id: run_id } });
    },
  });

  if (dep.isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!dep.data) return <div className="text-muted-foreground">Deployment not found.</div>;

  const d = dep.data;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link to="/deployments" className="text-xs text-muted-foreground hover:underline">
            ← Deployments
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">{d.name}</h1>
          <p className="text-sm text-muted-foreground">
            {d.blueprintId} ·{" "}
            <Badge
              className={d.status === "active" ? "bg-green-500/15 text-green-600" : "bg-muted"}
            >
              {d.status}
            </Badge>
          </p>
        </div>
        <Button onClick={() => trigger.mutate()} disabled={trigger.isPending}>
          {trigger.isPending ? "Triggering…" : "Trigger now"}
        </Button>
      </header>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Triggers</CardTitle>
          </CardHeader>
          <CardContent>
            {d.triggers.length === 0 ? (
              <div className="text-sm text-muted-foreground">No triggers configured.</div>
            ) : (
              <ul className="text-sm space-y-2">
                {d.triggers.map((t, i) => (
                  <li key={i} className="font-mono">
                    <span className="font-medium">{t.type}</span>
                    {t.type === "cron" && (
                      <span className="text-muted-foreground">
                        {" "}
                        {t.schedule}
                        {t.timezone ? ` (${t.timezone})` : ""}
                      </span>
                    )}
                    {t.type === "webhook" && (
                      <span className="text-muted-foreground"> auth={t.auth.kind}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Channels</CardTitle>
          </CardHeader>
          <CardContent>
            {d.channels.length === 0 ? (
              <div className="text-sm text-muted-foreground">No channels configured.</div>
            ) : (
              <ul className="text-sm space-y-2">
                {d.channels.map((c, i) => (
                  <li key={i} className="font-mono">
                    {c.type}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Run</TableHead>
              <TableHead>Triggered by</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.data?.runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <RunStatusBadge status={r.status} />
                </TableCell>
                <TableCell>
                  <Link
                    to="/runs/$id"
                    params={{ id: r.id }}
                    className="font-mono text-xs hover:underline"
                  >
                    {r.id.slice(0, 8)}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">{r.triggeredBy}</TableCell>
                <TableCell className="text-sm tabular-nums">{formatCost(r.costUsd)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatRelative(r.startedAt ?? r.createdAt)}
                </TableCell>
              </TableRow>
            ))}
            {recent.data?.runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No runs yet for this deployment.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
