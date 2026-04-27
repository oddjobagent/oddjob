import * as React from "react";
import { createRoute, Link } from "@tanstack/react-router";
import { Inbox, Plus, Send, Trash2 } from "lucide-react";

import type { ChannelConfig } from "@oddjob/core";

import { ChannelRow as ChannelRowComp } from "../components/deployments/ChannelRow.tsx";
import { Field } from "../components/ui/form.tsx";
import { Input } from "../components/ui/input.tsx";

import {
  useChannelTemplateMutations,
  useChannelTemplates,
  useChannelTypes,
  useDeployments,
  useTestChannel,
} from "../api/queries.ts";
import { ChannelRow } from "../components/deployments/ChannelRow.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";
import { EmptyState } from "../components/ui/empty-state.tsx";
import { useToast } from "../components/ui/toast.tsx";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/channels",
  component: ChannelsPage,
});

function ChannelsPage(): React.JSX.Element {
  const types = useChannelTypes();
  const deployments = useDeployments();
  const templates = useChannelTemplates();
  const tplMutations = useChannelTemplateMutations();
  const test = useTestChannel();
  const toast = useToast();

  const [testOpen, setTestOpen] = React.useState(false);
  const [testCfg, setTestCfg] = React.useState<ChannelConfig>({ type: "console" });
  const [tplDialog, setTplDialog] = React.useState(false);
  const [tplName, setTplName] = React.useState("");
  const [tplDesc, setTplDesc] = React.useState("");
  const [tplCfg, setTplCfg] = React.useState<ChannelConfig>({ type: "console" });

  const usage = collectUsage(deployments.data?.deployments ?? []);

  const onTest = async () => {
    try {
      await test.mutateAsync({ config: testCfg });
      toast.push("success", "Test message sent");
      setTestOpen(false);
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
          <p className="text-sm text-muted-foreground">
            How completed runs reach you. Test-fire any channel without affecting a deployment.
          </p>
        </div>
        <Button onClick={() => setTestOpen(true)}>
          <Send className="size-4" /> Test a channel
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Available channel types</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {types.data?.types.map((t) => (
            <div key={t.type} className="rounded-md border p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{t.label}</span>
                <Badge className="bg-muted text-muted-foreground font-mono text-xs">{t.type}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Templates</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setTplName("");
              setTplDesc("");
              setTplCfg({ type: "console" });
              setTplDialog(true);
            }}
          >
            <Plus className="size-4" /> New template
          </Button>
        </CardHeader>
        <CardContent>
          {templates.data?.templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No saved presets yet. Templates make it easy to reuse Slack channels, email
              recipients, or webhook URLs across deployments.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {templates.data?.templates.map((t) => (
                <li
                  key={t.name}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.type}
                      {t.description ? ` · ${t.description}` : ""}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await tplMutations.remove.mutateAsync(t.name);
                        toast.push("success", `Deleted template ${t.name}`);
                      } catch (e) {
                        toast.push("error", (e as Error).message);
                      }
                    }}
                    aria-label={`Delete ${t.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>In-use across deployments</CardTitle>
        </CardHeader>
        <CardContent>
          {usage.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No channels configured yet"
              description="Add a channel when creating or editing a deployment to get notified on runs."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {usage.map((u, i) => (
                <li key={i} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="font-mono text-xs text-muted-foreground">{u.type}</div>
                    <div>{u.label}</div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{u.deployments.length} deployment(s)</span>
                    <div className="flex gap-1">
                      {u.deployments.slice(0, 3).map((d) => (
                        <Link
                          key={d.id}
                          to="/deployments/$id"
                          params={{ id: d.id }}
                          className="rounded bg-muted px-2 py-0.5 hover:bg-accent"
                        >
                          {d.name}
                        </Link>
                      ))}
                      {u.deployments.length > 3 && <span className="text-muted-foreground">…</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent onClose={() => setTestOpen(false)}>
          <DialogHeader>
            <DialogTitle>Test a channel</DialogTitle>
          </DialogHeader>
          <ChannelRow value={testCfg} onChange={setTestCfg} types={types.data?.types ?? []} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onTest} disabled={test.isPending}>
              {test.isPending ? "Sending…" : "Send test message"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tplDialog} onOpenChange={setTplDialog}>
        <DialogContent onClose={() => setTplDialog(false)}>
          <DialogHeader>
            <DialogTitle>New channel template</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Name" required helper="e.g. seo-alerts-slack">
              <Input
                value={tplName}
                onChange={(e) => setTplName(e.target.value.replace(/[^a-z0-9-]/gi, "-"))}
              />
            </Field>
            <Field label="Description">
              <Input value={tplDesc} onChange={(e) => setTplDesc(e.target.value)} />
            </Field>
            <ChannelRowComp value={tplCfg} onChange={setTplCfg} types={types.data?.types ?? []} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTplDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!tplName) return toast.push("error", "name is required");
                try {
                  await tplMutations.upsert.mutateAsync({
                    name: tplName,
                    config: tplCfg,
                    description: tplDesc || undefined,
                  });
                  toast.push("success", `Saved template ${tplName}`);
                  setTplDialog(false);
                } catch (e) {
                  toast.push("error", (e as Error).message);
                }
              }}
              disabled={tplMutations.upsert.isPending}
            >
              {tplMutations.upsert.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface UsageEntry {
  type: string;
  label: string;
  deployments: { id: string; name: string }[];
}

function collectUsage(
  deployments: { id: string; name: string; channels: ChannelConfig[] }[],
): UsageEntry[] {
  const map = new Map<string, UsageEntry>();
  for (const d of deployments) {
    for (const c of d.channels) {
      const key = channelKey(c);
      const label = channelLabel(c);
      const e = map.get(key);
      if (e) e.deployments.push({ id: d.id, name: d.name });
      else map.set(key, { type: c.type, label, deployments: [{ id: d.id, name: d.name }] });
    }
  }
  return [...map.values()];
}

function channelKey(c: ChannelConfig): string {
  if (c.type === "slack") return `slack:${c.target}`;
  if (c.type === "email") return `email:${String(c.to)}`;
  if (c.type === "webhook") return `webhook:${c.url}`;
  return "console";
}

function channelLabel(c: ChannelConfig): string {
  if (c.type === "slack") return c.target;
  if (c.type === "email") return Array.isArray(c.to) ? c.to.join(", ") : c.to;
  if (c.type === "webhook") return c.url;
  return "stdout";
}
