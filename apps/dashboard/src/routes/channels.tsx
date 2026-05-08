import * as React from "react";
import { createRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Inbox, Plus, Send, Trash2 } from "lucide-react";

import type { ChannelConfig } from "@oddjob/core";

import {
  useChannelTemplateMutations,
  useChannelTemplates,
  useChannelTypes,
  useDeployments,
  useTestChannel,
} from "../api/queries.ts";
import { ChannelRow } from "../components/deployments/ChannelRow.tsx";
import { PageContainer } from "../components/layout/PageContainer.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";
import { EmptyState } from "../components/ui/empty-state.tsx";
import { Field } from "../components/ui/form.tsx";
import { Input } from "../components/ui/input.tsx";
import { PageHeader } from "../components/ui/page-header.tsx";
import { Section } from "../components/ui/section.tsx";
import { Surface } from "../components/ui/surface.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";
import { useToast } from "../components/ui/toast.tsx";

import { Route as RootRoute } from "./__root.tsx";

type ChannelsTab = "templates" | "types" | "in-use";

interface ChannelsSearch {
  tab: ChannelsTab;
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/channels",
  component: ChannelsPage,
  validateSearch: (raw): ChannelsSearch => ({
    tab: raw.tab === "types" ? "types" : raw.tab === "in-use" ? "in-use" : "templates",
  }),
});

function ChannelsPage(): React.JSX.Element {
  const types = useChannelTypes();
  const deployments = useDeployments();
  const templates = useChannelTemplates();
  const tplMutations = useChannelTemplateMutations();
  const test = useTestChannel();
  const toast = useToast();
  const navigate = useNavigate();
  const { tab } = useSearch({ from: "/channels" });
  const setTab = (v: string) => navigate({ to: "/channels", search: { tab: v as ChannelsTab } });

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
      toast.push("success", "Sent test message");
      setTestOpen(false);
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  return (
    <PageContainer className="space-y-6">
      <Tabs value={tab} onValueChange={setTab}>
        <PageHeader
          title="Channels"
          description="How completed runs reach you. Test-fire any channel without affecting a deployment."
          actions={
            <Button onClick={() => setTestOpen(true)}>
              <Send className="size-3.5" /> Test a channel
            </Button>
          }
          tabs={
            <TabsList>
              <TabsTrigger value="templates">Templates</TabsTrigger>
              <TabsTrigger value="types">Types</TabsTrigger>
              <TabsTrigger value="in-use">In use</TabsTrigger>
            </TabsList>
          }
        />

        <TabsContent value="templates">
          <Section
            title="Templates"
            description="Reusable channel presets — Slack rooms, email recipients, webhook URLs."
            actions={
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
                <Plus className="size-3.5" /> New template
              </Button>
            }
          >
            {templates.data?.templates.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="No templates yet"
                description="Save Slack channels, email recipients, or webhook URLs to reuse across deployments."
              />
            ) : (
              <ul className="space-y-2">
                {templates.data?.templates.map((t) => (
                  <li key={t.name}>
                    <Surface padding="sm">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-(--text)">{t.name}</div>
                          <div className="text-xs text-(--text-muted)">
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
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </Surface>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="types">
          <Section
            title="Available channel types"
            description="What kinds of delivery the running plugins support."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {types.data?.types.map((t) => (
                <Surface key={t.type} padding="md">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-(--text)">{t.label}</span>
                    <Badge size="sm" tone="outline" className="font-mono">
                      {t.type}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-(--text-muted)">{t.description}</p>
                </Surface>
              ))}
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="in-use">
          <Section
            title="In use across deployments"
            description="Where channels are actually wired. Click a deployment chip to jump to it."
          >
            {usage.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="No channels configured yet"
                description="Add a channel when creating or editing a deployment to get notified on runs."
              />
            ) : (
              <ul className="space-y-2">
                {usage.map((u, i) => (
                  <li key={i}>
                    <Surface padding="sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-mono text-[11px] text-(--text-muted)">{u.type}</div>
                          <div className="text-sm">{u.label}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-(--text-muted)">
                          <span>{u.deployments.length} deployment(s)</span>
                          {u.deployments.slice(0, 3).map((d) => (
                            <Link
                              key={d.id}
                              to="/deployments/$id"
                              params={{ id: d.id }}
                              className="rounded bg-(--surface-2) px-2 py-0.5 text-(--text) hover:bg-(--gray-4)"
                            >
                              {d.name}
                            </Link>
                          ))}
                          {u.deployments.length > 3 ? <span>…</span> : null}
                        </div>
                      </div>
                    </Surface>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </TabsContent>
      </Tabs>

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
            <Button onClick={onTest} loading={test.isPending}>
              Send test message
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
            <ChannelRow value={tplCfg} onChange={setTplCfg} types={types.data?.types ?? []} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTplDialog(false)}>
              Cancel
            </Button>
            <Button
              loading={tplMutations.upsert.isPending}
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
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
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
