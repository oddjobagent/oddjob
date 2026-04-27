import { createRoute, Link } from "@tanstack/react-router";
import { Loader2, X as XIcon } from "lucide-react";

import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { RunStatusBadge } from "../components/runs/RunStatusBadge.tsx";
import { useToast } from "../components/ui/toast.tsx";
import { useCancelRun, useRun, useRunLogs, useRunLogsStream } from "../api/queries.ts";
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
  const cancel = useCancelRun();
  const toast = useToast();

  if (run.isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!run.data) return <div className="text-muted-foreground">Run not found.</div>;

  const r = run.data;
  const duration = r.startedAt && r.finishedAt ? r.finishedAt - r.startedAt : undefined;
  const live = r.status === "running" || r.status === "queued";
  useRunLogsStream(id, live);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link to="/runs" className="text-xs text-muted-foreground hover:underline">
            ← Runs
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight font-mono">{r.id.slice(0, 12)}</h1>
          <p className="text-sm text-muted-foreground">
            {r.blueprintId} · {r.triggeredBy}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {live && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> live
            </span>
          )}
          <RunStatusBadge status={r.status} />
          {live && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  const res = await cancel.mutateAsync(id);
                  toast.push("success", `Cancelled (${res.result})`);
                } catch (e) {
                  toast.push("error", (e as Error).message);
                }
              }}
              disabled={cancel.isPending}
            >
              <XIcon className="size-3.5" /> Cancel
            </Button>
          )}
        </div>
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

      {r.outputValidation && r.outputValidation.source !== "skipped" && (
        <Card
          className={
            r.outputValidation.ok ? "border-emerald-500/40" : "border-destructive/50"
          }
        >
          <CardHeader>
            <CardTitle>
              Output validation: {r.outputValidation.ok ? "passed" : "failed"}
              {r.outputValidation.source === "no-output" && " (no structured output)"}
            </CardTitle>
          </CardHeader>
          {!r.outputValidation.ok && r.outputValidation.errors && (
            <CardContent>
              <ul className="space-y-1 font-mono text-xs">
                {r.outputValidation.errors.map((err, i) => (
                  <li key={i}>
                    <span className="text-muted-foreground">{err.path || "$"}</span>{" "}
                    <span className="text-destructive">{err.message}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
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
