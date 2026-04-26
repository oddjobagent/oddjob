import { createRoute, Link } from "@tanstack/react-router";

import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { useBlueprint } from "../api/queries.ts";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/blueprints/$namespace/$name",
  component: BlueprintDetail,
});

function BlueprintDetail(): React.JSX.Element {
  const { namespace, name } = Route.useParams();
  const id = `${namespace}/${name}`;
  const { data, isLoading } = useBlueprint(id);

  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!data) return <div className="text-muted-foreground">Blueprint not found.</div>;

  return (
    <div className="space-y-6">
      <header>
        <Link to="/blueprints" className="text-xs text-muted-foreground hover:underline">
          ← Blueprints
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">{data.id}</h1>
        <p className="text-sm text-muted-foreground">
          v{data.version} · {data.description}
        </p>
      </header>

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Model</CardTitle>
          </CardHeader>
          <CardContent className="text-sm font-mono break-all">{data.model}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Tools</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {data.tools.length === 0 ? "—" : data.tools.join(", ")}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Hash</CardTitle>
          </CardHeader>
          <CardContent className="text-xs font-mono break-all">{data.contentHash}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connectors</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(data.connectors).length === 0 ? (
            <div className="text-sm text-muted-foreground">No connectors.</div>
          ) : (
            <ul className="text-sm space-y-2">
              {Object.entries(data.connectors).map(([k, c]) => (
                <li key={k} className="font-mono">
                  <span className="font-medium">{k}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    {c.transport} · auth={c.auth.kind}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {Object.keys(data.scripts).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Scripts</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm space-y-2 font-mono">
              {Object.entries(data.scripts).map(([k, p]) => (
                <li key={k}>
                  <span className="font-medium">{k}</span>
                  <span className="text-muted-foreground"> → {p}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {data.skills.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Skills</CardTitle>
          </CardHeader>
          <CardContent className="text-sm font-mono">{data.skills.join(", ")}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>System prompt</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted/30 rounded p-3 text-xs overflow-auto whitespace-pre-wrap break-words">
            {data.prompt}
          </pre>
        </CardContent>
      </Card>

      {data.sourceToml && (
        <Card>
          <CardHeader>
            <CardTitle>blueprint.toml</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted/30 rounded p-3 text-xs overflow-auto">{data.sourceToml}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
