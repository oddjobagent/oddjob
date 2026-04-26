import { createRoute, Link } from "@tanstack/react-router";

import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { RunStatusBadge } from "../components/runs/RunStatusBadge.tsx";
import { useRun, useRunLogs } from "../api/queries.ts";
import { formatCost, formatDuration, formatTimestamp } from "../lib/format.ts";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/runs/$id",
  component: RunDetail,
});

function RunDetail(): React.JSX.Element {
  const { id } = Route.useParams();
  const run = useRun(id);
  const logs = useRunLogs(id);

  if (run.isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!run.data) return <div className="text-muted-foreground">Run not found.</div>;

  const r = run.data;
  const duration = r.startedAt && r.finishedAt ? r.finishedAt - r.startedAt : undefined;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link to="/runs" className="text-xs text-muted-foreground hover:underline">
            ← Runs
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight font-mono">{r.id.slice(0, 12)}</h1>
          <p className="text-sm text-muted-foreground">
            {r.blueprintId} · {r.triggeredBy}
          </p>
        </div>
        <RunStatusBadge status={r.status} />
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Cost" value={formatCost(r.costUsd)} />
        <Stat
          label="Tokens"
          value={`${r.tokenInput.toLocaleString()} / ${r.tokenOutput.toLocaleString()}`}
        />
        <Stat label="Duration" value={formatDuration(duration)} />
        <Stat label="Tools" value={String(r.toolCalls)} />
      </div>

      {r.error && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle>Error</CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-sm text-destructive">{r.error}</CardContent>
        </Card>
      )}

      {r.input !== undefined && r.input !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Input</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted/30 rounded p-3 text-xs overflow-auto whitespace-pre-wrap break-words">
              {typeof r.input === "string" ? r.input : JSON.stringify(r.input, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {r.output && (
        <Card>
          <CardHeader>
            <CardTitle>Output</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                final_text
              </div>
              <pre className="bg-muted/30 rounded p-3 text-sm overflow-auto whitespace-pre-wrap break-words">
                {r.output.finalText || "(empty)"}
              </pre>
            </div>
            {r.output.structuredOutput && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                  structured_output
                </div>
                <pre className="bg-muted/30 rounded p-3 text-xs overflow-auto">
                  {JSON.stringify(r.output.structuredOutput, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="font-mono text-xs space-y-0.5 max-h-96 overflow-auto">
            {logs.data?.entries.map((entry, idx) => (
              <div key={idx} className="flex gap-3">
                <span className="text-muted-foreground shrink-0">
                  {formatTimestamp(entry.timestamp)}
                </span>
                <span className={levelClass(entry.level)}>{entry.level.padEnd(5)}</span>
                <span>{entry.message}</span>
              </div>
            ))}
            {logs.data?.entries.length === 0 && (
              <div className="text-muted-foreground">No log entries.</div>
            )}
          </div>
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
        <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function levelClass(level: string): string {
  switch (level) {
    case "error":
      return "text-red-600 dark:text-red-400";
    case "warn":
      return "text-amber-600 dark:text-amber-400";
    case "info":
      return "text-foreground";
    case "debug":
      return "text-muted-foreground";
    default:
      return "";
  }
}
