import { createRoute, Link } from "@tanstack/react-router";

import { useHealth, useRuns, useStatus } from "../api/queries.ts";
import { PageContainer } from "../components/layout/PageContainer.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { EmptyState } from "../components/ui/empty-state.tsx";
import { PageHeader } from "../components/ui/page-header.tsx";
import { Section } from "../components/ui/section.tsx";
import { Stat } from "../components/ui/stat.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import { Activity } from "lucide-react";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/",
  component: Overview,
});

interface StatusShape {
  uptime_ms?: number;
  deployments?: number;
  scheduled?: unknown[];
  queue?: { queued: number; running: number; failed: number };
  max_workers?: number;
}

export function Overview(): React.JSX.Element {
  const health = useHealth();
  const status = useStatus();
  const s = (status.data as StatusShape | undefined) ?? undefined;
  const recentRuns = useRuns({ limit: 6 });

  const ok = health.data?.ok === true;
  const tone: "success" | "warn" | "danger" = health.isError ? "danger" : ok ? "success" : "warn";

  return (
    <PageContainer className="space-y-8">
      <PageHeader
        title="Overview"
        description="Live view of the running Oddjob server."
        actions={
          <Badge tone={tone} size="lg">
            {tone === "danger" ? "down" : ok ? "healthy" : "connecting"}
          </Badge>
        }
      />

      <Section title="Server">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4 [&>*+*]:border-l [&>*+*]:border-(--border-subtle) [&>*+*]:pl-6">
          <Stat label="Uptime" value={fmtUptime(s?.uptime_ms)} />
          <Stat label="Deployments" value={String(s?.deployments ?? 0)} />
          <Stat label="Scheduled" value={String(s?.scheduled?.length ?? 0)} />
          <Stat label="Workers" value={String(s?.max_workers ?? 0)} />
        </div>
      </Section>

      <Section title="Queue" description="Live counts from the SQLite queue.">
        <div className="grid grid-cols-3 gap-x-6 [&>*+*]:border-l [&>*+*]:border-(--border-subtle) [&>*+*]:pl-6">
          <Stat label="Queued" value={String(s?.queue?.queued ?? 0)} />
          <Stat
            label="Running"
            value={String(s?.queue?.running ?? 0)}
            trend={s?.queue?.running ? "up" : undefined}
          />
          <Stat
            label="Failed"
            value={String(s?.queue?.failed ?? 0)}
            trend={s?.queue?.failed ? "down" : undefined}
          />
        </div>
      </Section>

      <Section
        title="Recent runs"
        actions={
          <Link to="/runs" className="text-xs font-medium text-(--accent-9) hover:underline">
            View all →
          </Link>
        }
      >
        {recentRuns.isLoading ? (
          <div className="text-sm text-(--text-muted)">Loading…</div>
        ) : !recentRuns.data?.runs.length ? (
          <EmptyState
            icon={Activity}
            title="No runs yet"
            description="Trigger a deployment from /deployments or via webhook."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Run</TableHead>
                <TableHead>Deployment</TableHead>
                <TableHead className="text-right">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentRuns.data.runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Badge tone={statusTone(r.status)} size="sm">
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/runs/$id"
                      params={{ id: r.id }}
                      className="font-mono text-xs text-(--accent-9) hover:underline"
                    >
                      {r.id.slice(0, 12)}…
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-(--text-muted)">
                    {r.deploymentId ?? "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-(--text-muted)">
                    {fmtRelative(r.startedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </PageContainer>
  );
}

function statusTone(s: string): "default" | "success" | "warn" | "danger" | "info" | "accent" {
  if (s === "succeeded" || s === "completed") return "success";
  if (s === "failed" || s === "errored") return "danger";
  if (s === "running") return "accent";
  if (s === "queued" || s === "retrying") return "warn";
  return "default";
}

function fmtUptime(ms: number | undefined): string {
  if (!ms) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function fmtRelative(ts: number | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}
