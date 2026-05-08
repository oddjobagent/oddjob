import { useMemo, useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { Search, Star, X } from "lucide-react";

function fmtCost(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (n < 0.01) return n.toFixed(4).replace(/\.?0+$/, "");
  if (n < 1) return n.toFixed(3).replace(/\.?0+$/, "");
  return n.toFixed(2).replace(/\.?0+$/, "");
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function isRecent(releasedAt: string | undefined): boolean {
  if (!releasedAt) return false;
  const t = Date.parse(releasedAt);
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= NINETY_DAYS_MS;
}

import {
  useProvider,
  useProviderMutations,
  useProviders,
  useRoleMutations,
  useRoles,
} from "../api/queries.ts";
import { PageContainer } from "../components/layout/PageContainer.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Field } from "../components/ui/form.tsx";
import { Input } from "../components/ui/input.tsx";
import { PageHeader } from "../components/ui/page-header.tsx";
import { Surface } from "../components/ui/surface.tsx";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/providers",
  component: ProvidersPage,
});

type ProviderFilter = "all" | "with-key";
type CapFilter = "all" | "reasoning" | "tools" | "vision";

export function ProvidersPage(): React.JSX.Element {
  const { data: providers } = useProviders();
  const { data: roles } = useRoles();
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const detail = useProvider(selected);
  const { refresh, upsertCredential } = useProviderMutations();
  const roleMutations = useRoleMutations();
  const [apiKey, setApiKey] = useState("");

  // Filters
  const [providerQuery, setProviderQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [modelQuery, setModelQuery] = useState("");
  const [capFilter, setCapFilter] = useState<CapFilter>("all");
  const [recommendedOnly, setRecommendedOnly] = useState(false);
  const [recentOnly, setRecentOnly] = useState(false);
  const [showDeprecated, setShowDeprecated] = useState(false);

  const filteredProviders = useMemo(() => {
    const q = providerQuery.trim().toLowerCase();
    return (providers?.providers ?? [])
      .filter((p) => (providerFilter === "with-key" ? p.hasCredentials : true))
      .filter(
        (p) =>
          q === "" ||
          p.slug.toLowerCase().includes(q) ||
          p.displayName.toLowerCase().includes(q),
      );
  }, [providers, providerQuery, providerFilter]);

  const filteredModels = useMemo(() => {
    if (!detail.data) return [];
    const q = modelQuery.trim().toLowerCase();
    return detail.data.models
      .filter((m) => {
        if (capFilter === "reasoning" && !m.supports.reasoning) return false;
        if (capFilter === "tools" && !m.supports.tools) return false;
        if (capFilter === "vision" && !m.supports.vision) return false;
        if (recommendedOnly && !m.recommended) return false;
        if (recentOnly && !isRecent(m.releasedAt)) return false;
        if (!showDeprecated && m.deprecatedAt) return false;
        if (q === "") return true;
        return m.id.toLowerCase().includes(q);
      })
      .toSorted((a, b) => {
        if ((b.recommended ? 1 : 0) !== (a.recommended ? 1 : 0)) {
          return (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0);
        }
        const da = a.releasedAt ?? "";
        const db = b.releasedAt ?? "";
        if (da !== db) return db.localeCompare(da);
        return a.id.localeCompare(b.id);
      });
  }, [detail.data, modelQuery, capFilter, recommendedOnly, recentOnly, showDeprecated]);

  return (
    <PageContainer className="flex h-full min-h-0 flex-col gap-5 overflow-hidden pb-2">
      <PageHeader
        title="Models"
        description="Enable a provider, paste an API key, then assign one of its models to engine roles."
      />

      {(roles?.roles.length ?? 0) > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-(--border-subtle) bg-(--surface-1) px-3 py-2">
          <span className="text-[10px] font-medium uppercase tracking-widest text-(--text-subtle)">
            Roles
          </span>
          {roles?.roles.map((a) => (
            <span
              key={a.role}
              className="inline-flex items-center gap-1.5 rounded-md border border-(--border-subtle) bg-(--surface-raised) px-2 py-0.5"
            >
              <Badge tone="accent" size="sm">
                {a.role}
              </Badge>
              <span className="font-mono text-xs">
                {a.providerSlug}/{a.modelId}
              </span>
              {a.source === "config" ? (
                <Badge tone="warn" size="sm">
                  toml
                </Badge>
              ) : (
                <button
                  type="button"
                  onClick={() => roleMutations.remove.mutate(a.role)}
                  className="text-(--text-subtle) hover:text-(--text)"
                  aria-label={`Remove ${a.role} assignment`}
                >
                  <X className="size-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-6 md:flex-row">
        {/* Providers pane (left) */}
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-(--border-subtle) bg-(--surface-1) md:flex-1">
          <div className="space-y-2 border-b border-(--border-subtle) p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium uppercase tracking-widest text-(--text-subtle)">
                Providers ({filteredProviders.length})
              </span>
              <div className="flex gap-0.5 rounded-sm bg-(--surface-2) p-0.5 text-[10px]">
                {(["all", "with-key"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setProviderFilter(v)}
                    className={`rounded-sm px-1.5 py-0.5 font-medium transition-colors ${
                      providerFilter === v
                        ? "bg-(--surface-raised) text-(--text) shadow-sm"
                        : "text-(--text-muted) hover:text-(--text)"
                    }`}
                  >
                    {v === "all" ? "All" : "With key"}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-(--text-subtle)" />
              <Input
                value={providerQuery}
                onChange={(e) => setProviderQuery(e.target.value)}
                placeholder="Filter providers"
                className="pl-7"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {filteredProviders.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-(--text-muted)">
                No providers match.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {filteredProviders.map((p) => {
                  const active = selected === p.slug;
                  return (
                    <li key={p.slug}>
                      <button
                        type="button"
                        onClick={() => setSelected(p.slug)}
                        className={`block w-full rounded-md px-2.5 py-1.5 text-left transition-colors duration-(--duration-fast) ${
                          active
                            ? "bg-(--accent-3)/40 text-(--text)"
                            : "hover:bg-(--surface-2)"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[13px]">{p.slug}</span>
                          {p.hasCredentials ? (
                            <Badge tone="success" size="sm">
                              key
                            </Badge>
                          ) : null}
                        </div>
                        <div className="text-[11px] text-(--text-muted)">
                          {p.displayName}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Detail pane (right) */}
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-(--border-subtle) bg-(--surface-1) md:flex-[2]">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-(--text-muted)">
              Pick a provider on the left to manage its API key and model catalog.
            </div>
          ) : !detail.data ? (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-(--text-muted)">
              Loading…
            </div>
          ) : (
            <>
              <div className="space-y-3 border-b border-(--border-subtle) p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold tracking-(--tracking-snug)">
                      {detail.data.displayName}
                    </h2>
                    {detail.data.authHint ? (
                      <p className="mt-0.5 text-xs text-(--text-muted)">
                        {detail.data.authHint}
                      </p>
                    ) : null}
                  </div>
                  {detail.data.credentials.find((c) => c.credentialName === "default") ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => refresh.mutate(selected)}
                      loading={refresh.isPending}
                    >
                      Refresh catalog
                    </Button>
                  ) : null}
                </div>
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (apiKey)
                      upsertCredential.mutate(
                        { slug: selected, input: { apiKey } },
                        { onSuccess: () => setApiKey("") },
                      );
                  }}
                >
                  <Field label="API key" className="flex-1">
                    <Input
                      type="password"
                      placeholder="Paste key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                  </Field>
                  <Button type="submit" disabled={!apiKey} loading={upsertCredential.isPending}>
                    Save key
                  </Button>
                </form>
              </div>

              <div className="space-y-2 border-b border-(--border-subtle) p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-widest text-(--text-subtle)">
                    Models ({filteredModels.length} / {detail.data.models.length})
                  </span>
                  <div className="flex gap-0.5 rounded-sm bg-(--surface-2) p-0.5 text-[10px]">
                    {(["all", "reasoning", "tools", "vision"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setCapFilter(v)}
                        className={`rounded-sm px-1.5 py-0.5 font-medium capitalize transition-colors ${
                          capFilter === v
                            ? "bg-(--surface-raised) text-(--text) shadow-sm"
                            : "text-(--text-muted) hover:text-(--text)"
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setRecommendedOnly((v) => !v)}
                    className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-medium transition-colors ${
                      recommendedOnly
                        ? "bg-(--accent-3) text-(--text) ring-1 ring-(--accent-7)"
                        : "bg-(--surface-2) text-(--text-muted) hover:text-(--text)"
                    }`}
                  >
                    <Star className="size-3" />
                    Recommended
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecentOnly((v) => !v)}
                    className={`rounded-sm px-1.5 py-0.5 font-medium transition-colors ${
                      recentOnly
                        ? "bg-(--accent-3) text-(--text) ring-1 ring-(--accent-7)"
                        : "bg-(--surface-2) text-(--text-muted) hover:text-(--text)"
                    }`}
                  >
                    ≤90 days
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeprecated((v) => !v)}
                    className={`rounded-sm px-1.5 py-0.5 font-medium transition-colors ${
                      showDeprecated
                        ? "bg-(--surface-raised) text-(--text) shadow-sm"
                        : "bg-(--surface-2) text-(--text-muted) hover:text-(--text)"
                    }`}
                  >
                    Show deprecated
                  </button>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-(--text-subtle)" />
                  <Input
                    value={modelQuery}
                    onChange={(e) => setModelQuery(e.target.value)}
                    placeholder="Filter models by id"
                    className="pl-7"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                {filteredModels.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-(--text-muted)">
                    No models match.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {filteredModels.map((m) => (
                      <li key={m.id}>
                        <Surface padding="sm">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                {m.recommended ? (
                                  <Star
                                    className="size-3.5 shrink-0 fill-(--accent-9) text-(--accent-9)"
                                    aria-label="Recommended"
                                  />
                                ) : null}
                                <span className="font-mono text-sm text-(--text)">{m.id}</span>
                                {m.deprecatedAt ? (
                                  <Badge size="sm" tone="danger">
                                    deprecated
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="mt-1 text-xs tabular-nums text-(--text-muted)">
                                {m.contextWindow.toLocaleString()} ctx · $
                                {fmtCost(m.inputCostPerMillion)}/M in · $
                                {fmtCost(m.outputCostPerMillion)}/M out
                              </div>
                              {m.releasedAt || m.knowledgeCutoff ? (
                                <div className="mt-0.5 text-[11px] tabular-nums text-(--text-subtle)">
                                  {m.releasedAt ? `Released ${m.releasedAt}` : null}
                                  {m.releasedAt && m.knowledgeCutoff ? " · " : null}
                                  {m.knowledgeCutoff ? `knowledge ${m.knowledgeCutoff}` : null}
                                </div>
                              ) : null}
                              <div className="mt-2 flex flex-wrap gap-1">
                                {m.supports.tools ? (
                                  <Badge size="sm" tone="outline">
                                    tools
                                  </Badge>
                                ) : null}
                                {m.supports.vision ? (
                                  <Badge size="sm" tone="outline">
                                    vision
                                  </Badge>
                                ) : null}
                                {m.supports.reasoning ? (
                                  <Badge size="sm" tone="outline">
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
                                  loading={roleMutations.set.isPending}
                                >
                                  Use as {role}
                                </Button>
                              ))}
                            </div>
                          </div>
                        </Surface>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
