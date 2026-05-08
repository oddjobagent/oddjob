import { useState } from "react";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Plus } from "lucide-react";

import {
  useBlueprint,
  useBlueprintTags,
  useBlueprintVersions,
  useRemoveBlueprintTag,
  useSetBlueprintTag,
} from "../api/queries.ts";
import { PageContainer } from "../components/layout/PageContainer.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { DataList } from "../components/ui/data-list.tsx";
import { Field } from "../components/ui/form.tsx";
import { Input } from "../components/ui/input.tsx";
import { PageHeader } from "../components/ui/page-header.tsx";
import { Section } from "../components/ui/section.tsx";
import { Surface } from "../components/ui/surface.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";

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
  const navigate = useNavigate();
  const [newTag, setNewTag] = useState("");
  const [newTagVersion, setNewTagVersion] = useState("");

  if (isLoading)
    return (
      <PageContainer>
        <div className="text-(--text-muted)">Loading…</div>
      </PageContainer>
    );
  if (!data)
    return (
      <PageContainer>
        <div className="text-(--text-muted)">Blueprint not found.</div>
      </PageContainer>
    );

  const tagsByVersion = new Map<string, string[]>();
  for (const t of tagsQ.data?.tags ?? []) {
    const arr = tagsByVersion.get(t.version) ?? [];
    arr.push(t.tag);
    tagsByVersion.set(t.version, arr);
  }

  return (
    <PageContainer className="space-y-8">
      <PageHeader
        eyebrow={
          <Link to="/blueprints" className="inline-flex items-center gap-1 hover:text-(--text)">
            <ArrowLeft className="size-3" /> Blueprints
          </Link>
        }
        title={data.id}
        description={data.description || `v${data.version}`}
        actions={
          <Button
            onClick={() => navigate({ to: "/deployments/new", search: { blueprint: data.id } })}
          >
            <Plus className="size-3.5" /> Create deployment
          </Button>
        }
      />

      <Section title="Overview">
        <DataList>
          <DataList.Item label="Model" mono>
            {data.model}
          </DataList.Item>
          <DataList.Item label="Tools">
            {data.tools.length === 0 ? "—" : data.tools.join(", ")}
          </DataList.Item>
          {data.skills.length > 0 ? (
            <DataList.Item label="Skills" mono>
              {data.skills.join(", ")}
            </DataList.Item>
          ) : null}
          <DataList.Item label="Hash" mono>
            {data.contentHash.slice(0, 16)}…
          </DataList.Item>
          <DataList.Item label="Version" mono>
            v{data.version}
          </DataList.Item>
        </DataList>
      </Section>

      {Object.keys(data.connectors).length > 0 ? (
        <Section title="Connectors">
          <ul className="space-y-2 text-sm">
            {Object.entries(data.connectors).map(([k, c]) => (
              <li key={k} className="font-mono">
                <span className="font-medium text-(--text)">{k}</span>
                <span className="text-(--text-muted)">
                  {" "}
                  {c.transport} · auth={c.auth.kind}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {Object.keys(data.scripts).length > 0 ? (
        <Section title="Scripts">
          <ul className="space-y-2 font-mono text-sm">
            {Object.entries(data.scripts).map(([k, p]) => (
              <li key={k}>
                <span className="font-medium text-(--text)">{k}</span>
                <span className="text-(--text-muted)"> → {p}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="System prompt">
        <Surface variant="raised" padding="sm">
          <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
            {data.prompt}
          </pre>
        </Surface>
      </Section>

      <Section title="Versions & tags">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Hash</TableHead>
              <TableHead className="text-right">Pushed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(versionsQ.data?.versions ?? []).map((v) => (
              <TableRow key={v.version}>
                <TableCell className="font-mono text-sm">{v.version}</TableCell>
                <TableCell className="space-x-1">
                  {(tagsByVersion.get(v.version) ?? []).map((t) => (
                    <Badge key={t} tone={t === "latest" ? "accent" : "default"} size="sm">
                      {t}
                      {t !== "latest" ? (
                        <button
                          type="button"
                          className="ml-1 opacity-70 hover:opacity-100"
                          onClick={() => removeTag.mutate(t)}
                          aria-label={`remove ${t}`}
                        >
                          ×
                        </button>
                      ) : null}
                    </Badge>
                  ))}
                </TableCell>
                <TableCell className="font-mono text-xs text-(--text-muted)">
                  {v.contentHash.slice(0, 12)}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums text-(--text-muted)">
                  {new Date(v.createdAt).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <form
          className="mt-4 flex items-end gap-2"
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
          <Field label="Tag" className="flex-1">
            <Input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="stable"
            />
          </Field>
          <Field label="Version" className="flex-1">
            <Input
              value={newTagVersion}
              onChange={(e) => setNewTagVersion(e.target.value)}
              placeholder="0.1.0"
            />
          </Field>
          <Button type="submit" loading={setTag.isPending}>
            Pin tag
          </Button>
        </form>
      </Section>

      {data.sourceToml ? (
        <Section title="blueprint.toml">
          <Surface variant="raised" padding="sm">
            <pre className="overflow-auto font-mono text-xs">{data.sourceToml}</pre>
          </Surface>
        </Section>
      ) : null}
    </PageContainer>
  );
}
