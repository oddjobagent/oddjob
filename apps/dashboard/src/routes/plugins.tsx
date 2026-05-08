import { createRoute } from "@tanstack/react-router";

import { usePlugins, useTogglePlugin } from "../api/queries.ts";
import { Badge } from "../components/ui/badge.tsx";
import { Section } from "../components/ui/section.tsx";
import { Surface } from "../components/ui/surface.tsx";
import { Switch } from "../components/ui/switch.tsx";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/plugins",
  component: PluginsPage,
});

export function PluginsPage(): React.JSX.Element {
  const { data, isLoading } = usePlugins();
  const toggle = useTogglePlugin();

  return (
    <div className="space-y-8">
      <Section
        title="Installed plugins"
        description={
          <>
            Bundled + side-loaded from{" "}
            <code className="font-mono text-[11px]">~/.oddjob/plugins/</code>. Restart the server
            after installing or removing local plugins.
          </>
        }
      >
        {isLoading ? (
          <div className="text-sm text-(--text-muted)">Loading…</div>
        ) : data?.plugins.length === 0 ? (
          <div className="text-sm text-(--text-muted)">No plugins installed.</div>
        ) : (
          <ul className="space-y-2">
            {data?.plugins.map((p) => (
              <li key={p.slug}>
                <Surface padding="md">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium text-(--text)">
                          {p.slug}
                        </span>
                        <Badge size="sm">{p.version}</Badge>
                        <Badge size="sm" tone={p.source === "bundled" ? "info" : "default"}>
                          {p.source}
                        </Badge>
                        {!p.enabled ? (
                          <Badge size="sm" tone="danger">
                            disabled
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-sm text-(--text-muted)">{p.description}</p>
                      {p.services.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {p.services.map((s, i) => (
                            <Badge key={i} size="sm" tone="outline">
                              {s.kind}
                              {s.id ? `:${s.id}` : ""}
                              {s.type ? `:${s.type}` : ""}
                              {s.name ? `:${s.name}` : ""}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <Switch
                      checked={p.enabled}
                      disabled={toggle.isPending}
                      onCheckedChange={(checked) =>
                        toggle.mutate({ slug: p.slug, enabled: checked })
                      }
                      aria-label={`${p.enabled ? "Disable" : "Enable"} ${p.slug}`}
                    />
                  </div>
                </Surface>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Local install"
        description="Copy a directory with oddjob-plugin.toml + an entry file into ~/.oddjob/plugins/<slug>/, then restart the server."
      >
        <Surface variant="raised" padding="md" className="text-sm text-(--text-muted)">
          <p>
            Or use the CLI:{" "}
            <code className="font-mono text-xs text-(--text)">
              oddjob plugin install ./my-plugin
            </code>
          </p>
        </Surface>
      </Section>
    </div>
  );
}
