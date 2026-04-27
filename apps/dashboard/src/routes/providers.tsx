import { useState } from "react";
import { createRoute } from "@tanstack/react-router";

import {
  useProvider,
  useProviderMutations,
  useProviders,
  useRoleMutations,
  useRoles,
} from "../api/queries.ts";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Input } from "../components/ui/input.tsx";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/providers",
  component: Providers,
});

function Providers(): React.JSX.Element {
  const { data: providers } = useProviders();
  const { data: roles } = useRoles();
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const detail = useProvider(selected);
  const { refresh, upsertCredential } = useProviderMutations();
  const roleMutations = useRoleMutations();
  const [apiKey, setApiKey] = useState("");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Model Providers</h1>
        <p className="text-sm text-muted-foreground">
          Enable a provider, paste an API key, then assign one of its models to the engine roles
          (default / advisor / grader).
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Engine role assignments</CardTitle>
        </CardHeader>
        <CardContent>
          {roles?.roles.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No role assignments yet. Pick a model below and click "Set as default".
            </div>
          ) : (
            <ul className="space-y-2">
              {roles?.roles.map((a) => (
                <li
                  key={a.role}
                  className="flex items-center justify-between border-b last:border-b-0 pb-2"
                >
                  <div className="flex items-center gap-2">
                    <Badge className="bg-blue-500/15 text-blue-700">{a.role}</Badge>
                    <span className="font-mono text-sm">
                      {a.providerSlug}/{a.modelId}
                    </span>
                    {a.source === "config" ? (
                      <Badge className="bg-amber-500/15 text-amber-700 text-xs">config.toml</Badge>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => roleMutations.remove.mutate(a.role)}
                    disabled={roleMutations.remove.isPending}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Providers</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {providers?.providers.map((p) => (
                <li key={p.slug}>
                  <button
                    type="button"
                    className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground ${
                      selected === p.slug ? "bg-accent text-accent-foreground" : ""
                    }`}
                    onClick={() => setSelected(p.slug)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono">{p.slug}</span>
                      <span className="flex gap-1">
                        {p.hasCredentials ? (
                          <Badge className="bg-emerald-500/15 text-emerald-700 text-xs">key</Badge>
                        ) : null}
                        {p.hasRefresh ? (
                          <Badge className="bg-muted text-muted-foreground text-xs">live</Badge>
                        ) : null}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">{p.displayName}</div>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{detail.data?.displayName ?? "Select a provider"}</CardTitle>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <div className="text-sm text-muted-foreground">
                Pick a provider on the left to manage its API key + model catalog.
              </div>
            ) : !detail.data ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : (
              <div className="space-y-4">
                {detail.data.authHint ? (
                  <p className="text-sm text-muted-foreground">{detail.data.authHint}</p>
                ) : null}

                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (apiKey)
                      upsertCredential.mutate(
                        { slug: selected, input: { apiKey } },
                        { onSuccess: () => setApiKey("") },
                      );
                  }}
                >
                  <Input
                    type="password"
                    placeholder="Paste API key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="flex-1"
                  />
                  <Button type="submit" disabled={!apiKey || upsertCredential.isPending}>
                    Save key
                  </Button>
                  {detail.data.credentials.find((c) => c.credentialName === "default") ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => refresh.mutate(selected)}
                      disabled={refresh.isPending}
                    >
                      Refresh catalog
                    </Button>
                  ) : null}
                </form>

                <div>
                  <h3 className="text-sm font-medium mb-2">Models</h3>
                  <div className="space-y-2 max-h-[420px] overflow-auto">
                    {detail.data.models.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-start justify-between border rounded-md p-3"
                      >
                        <div>
                          <div className="font-mono text-sm">{m.id}</div>
                          <div className="text-xs text-muted-foreground">
                            {m.contextWindow.toLocaleString()} ctx · ${m.inputCostPerMillion}/in $
                            {m.outputCostPerMillion}/out per 1M
                          </div>
                          <div className="mt-1 flex gap-1">
                            {m.supports.tools ? (
                              <Badge className="bg-muted text-muted-foreground text-xs">
                                tools
                              </Badge>
                            ) : null}
                            {m.supports.vision ? (
                              <Badge className="bg-muted text-muted-foreground text-xs">
                                vision
                              </Badge>
                            ) : null}
                            {m.supports.reasoning ? (
                              <Badge className="bg-muted text-muted-foreground text-xs">
                                reasoning
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          {(["default", "advisor", "grader"] as const).map((role) => (
                            <Button
                              key={role}
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                roleMutations.set.mutate({
                                  role,
                                  input: { providerSlug: selected, modelId: m.id },
                                })
                              }
                              disabled={roleMutations.set.isPending}
                            >
                              Use as {role}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
