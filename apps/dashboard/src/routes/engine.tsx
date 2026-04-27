import * as React from "react";
import { createRoute } from "@tanstack/react-router";
import { AlertTriangle, Save } from "lucide-react";

import type { BuiltinToolsConfig, WebSearchConfig } from "@oddjob/core";

import { useEngine, useEngineTools, useUpdateEngine } from "../api/queries.ts";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Field, Fieldset } from "../components/ui/form.tsx";
import { Input } from "../components/ui/input.tsx";
import { Select } from "../components/ui/select.tsx";
import { useToast } from "../components/ui/toast.tsx";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/engine",
  component: EnginePage,
});

function EnginePage(): React.JSX.Element {
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

  if (!draft) return <div className="text-muted-foreground">Loading…</div>;

  const save = async () => {
    try {
      await update.mutateAsync({ builtinTools: draft });
      toast.push("success", "Engine config updated");
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  const setSearch = (next: Partial<WebSearchConfig>) =>
    setDraft({
      ...draft,
      webSearch: { provider: "brave", ...draft.webSearch, ...next } as WebSearchConfig,
    });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Engine</h1>
        <p className="text-sm text-muted-foreground">
          Configure built-in tools and runtime settings. Builtin-tool config hot-reloads; server
          host / port / token need a restart.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Server</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3 text-sm">
          <Stat label="Host" value={engine.data?.restartRequired.host ?? "—"} />
          <Stat label="Port" value={String(engine.data?.restartRequired.port ?? "—")} />
          <Stat
            label="Bearer token"
            value={engine.data?.restartRequired.bearerTokenRequired ? "required" : "open (loopback)"}
          />
        </CardContent>
      </Card>

      <Card className="border-amber-500/40 bg-amber-50/30 dark:bg-amber-950/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-600" /> Sandbox: trusted-local only
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Scripts and bash run in a Bun subprocess with an isolated tempdir, but they share the host
          network and inherited environment variables. Treat blueprints you push as trusted code.
        </CardContent>
      </Card>

      <Fieldset legend="Built-in tools">
        <div className="grid gap-3">
          {tools.data?.tools.map((t) => (
            <details key={t.name} className="rounded-md border bg-background p-3">
              <summary className="flex items-center justify-between cursor-pointer">
                <span className="font-mono text-sm">{t.name}</span>
                <span className="flex items-center gap-2">
                  <Badge className="bg-muted text-muted-foreground">{t.category}</Badge>
                  {t.configurable && (
                    <Badge className="bg-emerald-500/15 text-emerald-700">configurable</Badge>
                  )}
                </span>
              </summary>
              <p className="mt-2 text-sm text-muted-foreground">{t.description}</p>
              {t.name === "web_search" && (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field label="Provider">
                    <Select
                      value={draft.webSearch?.provider ?? ""}
                      onChange={(e) =>
                        setSearch({
                          provider: (e.target.value || "brave") as WebSearchConfig["provider"],
                        })
                      }
                    >
                      <option value="">— off —</option>
                      <option value="brave">Brave</option>
                      <option value="tavily">Tavily</option>
                      <option value="searxng">SearXNG</option>
                    </Select>
                  </Field>
                  <Field
                    label="API key"
                    helper="paste a key. Stored in config.toml; not encrypted."
                  >
                    <Input
                      value={draft.webSearch?.apiKey ?? ""}
                      onChange={(e) => setSearch({ apiKey: e.target.value || undefined })}
                      placeholder="(leave blank if SearXNG self-host)"
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
              )}
              {t.name === "web_fetch" && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
              )}
              {(t.name === "python_repl" || t.name === "javascript_repl") && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Timeout ms">
                    <Input
                      type="number"
                      value={
                        (t.name === "python_repl"
                          ? draft.pythonRepl?.timeoutMs
                          : draft.javascriptRepl?.timeoutMs) ?? ""
                      }
                      onChange={(e) => {
                        const v = e.target.value === "" ? undefined : Number(e.target.value);
                        setDraft(
                          t.name === "python_repl"
                            ? { ...draft, pythonRepl: { timeoutMs: v } }
                            : { ...draft, javascriptRepl: { timeoutMs: v } },
                        );
                      }}
                      placeholder={t.name === "python_repl" ? "30000" : "10000"}
                    />
                  </Field>
                </div>
              )}
            </details>
          ))}
        </div>
      </Fieldset>

      <div className="sticky bottom-0 bg-background/90 backdrop-blur py-3 border-t flex items-center gap-2">
        <Button onClick={save} disabled={update.isPending}>
          <Save className="size-4" /> {update.isPending ? "Saving…" : "Save engine config"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Hot-reloads. In-flight runs keep their existing snapshot.
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono">{value}</div>
    </div>
  );
}
