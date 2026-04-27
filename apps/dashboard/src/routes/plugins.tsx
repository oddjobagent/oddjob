import { createRoute } from "@tanstack/react-router";

import { usePlugins, useTogglePlugin } from "../api/queries.ts";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/plugins",
  component: Plugins,
});

function Plugins(): React.JSX.Element {
  const { data, isLoading } = usePlugins();
  const toggle = useTogglePlugin();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Plugins</h1>
        <p className="text-sm text-muted-foreground">
          Bundled providers + side-loaded plugins from{" "}
          <code className="font-mono text-xs">~/.oddjob/plugins/</code>. Restart the server after
          installing or removing local plugins.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Installed</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : data?.plugins.length === 0 ? (
            <div className="text-sm text-muted-foreground">No plugins installed.</div>
          ) : (
            <ul className="space-y-3">
              {data?.plugins.map((p) => (
                <li
                  key={p.slug}
                  className="flex items-center justify-between border-b last:border-b-0 pb-3"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{p.slug}</span>
                      <Badge className="bg-muted text-muted-foreground text-xs">{p.version}</Badge>
                      <Badge
                        className={
                          p.source === "bundled"
                            ? "bg-blue-500/15 text-blue-700"
                            : "bg-muted text-muted-foreground"
                        }
                      >
                        {p.source}
                      </Badge>
                      {!p.enabled ? (
                        <Badge className="bg-red-500/15 text-red-700">disabled</Badge>
                      ) : null}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">{p.description}</div>
                    <div className="mt-2 flex gap-1 flex-wrap">
                      {p.services.map((s, i) => (
                        <Badge key={i} className="bg-muted text-muted-foreground text-xs">
                          {s.kind}
                          {s.id ? `:${s.id}` : ""}
                          {s.type ? `:${s.type}` : ""}
                          {s.name ? `:${s.name}` : ""}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate({ slug: p.slug, enabled: !p.enabled })}
                  >
                    {p.enabled ? "Disable" : "Enable"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Local install</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            To install a local plugin, copy a directory containing{" "}
            <code className="font-mono text-xs">oddjob-plugin.toml</code> + an entry file into{" "}
            <code className="font-mono text-xs">~/.oddjob/plugins/&lt;slug&gt;/</code>, then restart
            the server.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Or use the CLI:{" "}
            <code className="font-mono text-xs">oddjob plugin install ./my-plugin</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
