import * as React from "react";
import { createRoute } from "@tanstack/react-router";
import { AlertTriangle, Save } from "lucide-react";

import type { BuiltinToolsConfig, WebSearchConfig } from "@oddjob/core";

import { useEngine, useEngineTools, useUpdateEngine } from "../api/queries.ts";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../components/ui/accordion.tsx";
import { DataList } from "../components/ui/data-list.tsx";
import { Field } from "../components/ui/form.tsx";
import { Input } from "../components/ui/input.tsx";
import { Section } from "../components/ui/section.tsx";
import { Select } from "../components/ui/select.tsx";
import { Stat } from "../components/ui/stat.tsx";
import { Surface } from "../components/ui/surface.tsx";
import { useToast } from "../components/ui/toast.tsx";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/engine",
  component: EnginePageBody,
});

export function EnginePageBody(): React.JSX.Element {
  const engine = useEngine();
  const tools = useEngineTools();
  const update = useUpdateEngine();
  const toast = useToast();

  const [draft, setDraft] = React.useState<BuiltinToolsConfig | null>(null);

  React.useEffect(() => {
    if (engine.data && draft === null) {
      setDraft(engine.data.engine?.builtinTools ?? {});
    }
  }, [engine.data, draft]);

  if (!draft) return <div className="text-(--text-muted)">Loading…</div>;

  const save = async () => {
    try {
      await update.mutateAsync({ builtinTools: draft });
      toast.push("success", "Saved engine config");
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  const setSearch = (next: Partial<WebSearchConfig>) =>
    setDraft({ ...draft, webSearch: { ...draft.webSearch, ...next } });

  return (
    <div className="space-y-8">
      <Section
        title="Built-in tools"
        description="Hot-reloads. In-flight runs keep their existing snapshot."
      >
        <Accordion
          type="multiple"
          className="rounded-md border border-(--border-subtle) bg-(--surface-1) px-4"
        >
          {tools.data?.tools.map((t) => (
            <AccordionItem key={t.name} value={t.name}>
              <AccordionTrigger>
                <div className="flex flex-1 items-center justify-between gap-2 pr-2">
                  <span className="font-mono text-sm text-(--text)">{t.name}</span>
                  <span className="flex items-center gap-1.5">
                    <Badge size="sm">{t.category}</Badge>
                    {t.configurable ? (
                      <Badge size="sm" tone="success">
                        configurable
                      </Badge>
                    ) : null}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <p className="mb-3 text-sm">{t.description}</p>
                {t.name === "web_search" ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Plugin">
                      <Select
                        value={draft.webSearch?.plugin ?? ""}
                        onChange={(e) => setSearch({ plugin: e.target.value || "brave" })}
                      >
                        <option value="">— off —</option>
                        <option value="brave">Brave</option>
                        <option value="tavily">Tavily</option>
                        <option value="searxng">SearXNG</option>
                        <option value="exa">Exa</option>
                        <option value="serpapi">SerpAPI</option>
                      </Select>
                    </Field>
                    <Field label="API key" helper="Stored in config.toml; not encrypted.">
                      <Input
                        value={draft.webSearch?.apiKey ?? ""}
                        onChange={(e) => setSearch({ apiKey: e.target.value || undefined })}
                        placeholder="(blank for SearXNG self-host)"
                      />
                    </Field>
                    <Field label="Max results">
                      <Input
                        type="number"
                        value={draft.webSearch?.maxResults ?? ""}
                        onChange={(e) =>
                          setSearch({
                            maxResults: e.target.value === "" ? undefined : Number(e.target.value),
                          })
                        }
                        placeholder="10"
                      />
                    </Field>
                  </div>
                ) : null}
                {t.name === "web_fetch" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Max body MB">
                      <Input
                        type="number"
                        value={draft.webFetch?.maxBodyMb ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            webFetch: {
                              ...draft.webFetch,
                              maxBodyMb: e.target.value === "" ? undefined : Number(e.target.value),
                            },
                          })
                        }
                        placeholder="5"
                      />
                    </Field>
                    <Field label="Allow private IPs" helper="docker.internal etc.">
                      <Select
                        value={String(draft.webFetch?.privateIpsAllowed ?? false)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            webFetch: {
                              ...draft.webFetch,
                              privateIpsAllowed: e.target.value === "true",
                            },
                          })
                        }
                      >
                        <option value="false">no (default)</option>
                        <option value="true">yes</option>
                      </Select>
                    </Field>
                  </div>
                ) : null}
                {t.name === "python" || t.name === "javascript" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Timeout ms">
                      <Input
                        type="number"
                        value={
                          (t.name === "python"
                            ? draft.python?.timeoutMs
                            : draft.javascript?.timeoutMs) ?? ""
                        }
                        onChange={(e) => {
                          const v = e.target.value === "" ? undefined : Number(e.target.value);
                          setDraft(
                            t.name === "python"
                              ? { ...draft, python: { timeoutMs: v } }
                              : { ...draft, javascript: { timeoutMs: v } },
                          );
                        }}
                        placeholder={t.name === "python" ? "30000" : "10000"}
                      />
                    </Field>
                  </div>
                ) : null}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Section>

      <Surface tone="warn" padding="md">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-(--warn-9)" aria-hidden />
          <div className="text-sm">
            <p className="font-medium text-(--text)">Sandbox: trusted-local only</p>
            <p className="mt-1 text-(--text-muted)">
              Scripts and bash run in a Bun subprocess with an isolated tempdir, but they share the
              host network and inherited environment variables. Treat blueprints you push as trusted
              code.
            </p>
          </div>
        </div>
      </Surface>

      <div className="sticky bottom-0 -mx-2 flex items-center gap-3 border-t border-(--border-subtle) bg-background/90 px-2 py-3 backdrop-blur">
        <Button onClick={save} loading={update.isPending}>
          <Save className="size-3.5" /> Save engine config
        </Button>
        <span className="text-xs text-(--text-muted)">
          Hot-reloads. In-flight runs keep their existing snapshot.
        </span>
      </div>
    </div>
  );
}

export function ServerSettingsBody(): React.JSX.Element {
  const engine = useEngine();
  const r = engine.data?.restartRequired;

  return (
    <div className="space-y-8">
      <Section
        title="HTTP server"
        description="Read-only — change in config.toml and restart the server."
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 [&>*+*]:border-l [&>*+*]:border-(--border-subtle) [&>*+*]:pl-6">
          <Stat label="Host" value={<span className="font-mono">{r?.host ?? "—"}</span>} />
          <Stat label="Port" value={<span className="font-mono">{String(r?.port ?? "—")}</span>} />
          <Stat
            label="Bearer token"
            value={r?.bearerTokenRequired ? "required" : "open"}
            hint={r?.bearerTokenRequired ? undefined : "loopback bind"}
          />
        </div>
      </Section>

      <Section title="Defaults">
        <DataList>
          <DataList.Item label="Default environment">
            <span className="font-mono text-xs">{engine.data?.defaultEnvironmentId ?? "—"}</span>
          </DataList.Item>
        </DataList>
      </Section>
    </div>
  );
}
