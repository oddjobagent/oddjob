import { useState } from "react";
import { createRoute, Link } from "@tanstack/react-router";

import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Input } from "../components/ui/input.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import {
  useBlueprint,
  useBlueprintTags,
  useBlueprintVersions,
  useRemoveBlueprintTag,
  useSetBlueprintTag,
} from "../api/queries.ts";

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
  const versionsQ = useBlueprintVersions(id);
  const tagsQ = useBlueprintTags(id);
  const setTag = useSetBlueprintTag(id);
  const removeTag = useRemoveBlueprintTag(id);
  const [newTag, setNewTag] = useState("");
  const [newTagVersion, setNewTagVersion] = useState("");

  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!data) return <div className="text-muted-foreground">Blueprint not found.</div>;

  const tagsByVersion = new Map<string, string[]>();
  for (const t of tagsQ.data?.tags ?? []) {
    const arr = tagsByVersion.get(t.version) ?? [];
    arr.push(t.tag);
    tagsByVersion.set(t.version, arr);
  }

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

      <Card>
        <CardHeader>
          <CardTitle>Versions &amp; tags</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Hash</TableHead>
                <TableHead>Pushed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(versionsQ.data?.versions ?? []).map((v) => (
                <TableRow key={v.version}>
                  <TableCell className="font-mono">{v.version}</TableCell>
                  <TableCell className="space-x-1">
                    {(tagsByVersion.get(v.version) ?? []).map((t) => (
                      <Badge
                        key={t}
                        className={
                          t === "latest"
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-secondary-foreground"
                        }
                      >
                        {t}
                        {t !== "latest" && (
                          <button
                            type="button"
                            className="ml-1 text-xs opacity-70 hover:opacity-100"
                            onClick={() => removeTag.mutate(t)}
                            aria-label={`remove ${t}`}
                          >
                            ×
                          </button>
                        )}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{v.contentHash.slice(0, 12)}</TableCell>
                  <TableCell className="text-xs">{new Date(v.createdAt).toISOString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <form
            className="flex gap-2 items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newTag || !newTagVersion) return;
              setTag.mutate(
                { tag: newTag, version: newTagVersion },
                {
                  onSuccess: () => {
                    setNewTag("");
                    setNewTagVersion("");
                  },
                },
              );
            }}
          >
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Tag</label>
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="stable"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Version</label>
              <Input
                value={newTagVersion}
                onChange={(e) => setNewTagVersion(e.target.value)}
                placeholder="0.1.0"
              />
            </div>
            <Button type="submit" disabled={setTag.isPending}>
              Pin tag
            </Button>
          </form>
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
