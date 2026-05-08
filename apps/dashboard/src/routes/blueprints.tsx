import { createRoute, Link } from "@tanstack/react-router";
import { Box } from "lucide-react";

import { useBlueprints } from "../api/queries.ts";
import { PageContainer } from "../components/layout/PageContainer.tsx";
import { EmptyState } from "../components/ui/empty-state.tsx";
import { PageHeader } from "../components/ui/page-header.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Surface } from "../components/ui/surface.tsx";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/blueprints",
  component: Blueprints,
});

function Blueprints(): React.JSX.Element {
  const { data, isLoading } = useBlueprints();
  const blueprints = data?.blueprints ?? [];

  return (
    <PageContainer className="space-y-6">
      <PageHeader title="Blueprints" description="Pushed agent definitions." />

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : blueprints.length === 0 ? (
        <EmptyState
          icon={Box}
          title="No blueprints yet"
          description="Use `oddjob push` to upload one."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {blueprints.map((bp) => (
            <Link
              key={bp.id}
              to="/blueprints/$namespace/$name"
              params={{ namespace: bp.namespace, name: bp.name }}
              className="block focus-visible:outline-none"
            >
              <Surface
                padding="md"
                className="h-full transition-colors duration-(--duration-fast) hover:border-(--accent-7) hover:bg-(--surface-2)"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-mono text-sm font-medium text-(--text)">{bp.id}</div>
                  <span className="rounded-sm bg-(--surface-2) px-1.5 py-0.5 font-mono text-[10px] text-(--text-muted)">
                    v{bp.version}
                  </span>
                </div>
                {bp.description ? (
                  <p className="mt-2 text-sm text-(--text-muted) line-clamp-2">{bp.description}</p>
                ) : null}
                <div className="mt-3 flex items-center justify-between text-[10px] text-(--text-subtle)">
                  <span className="font-mono">{bp.contentHash.slice(0, 8)}</span>
                  {bp.model ? <span className="font-mono">{bp.model}</span> : null}
                </div>
              </Surface>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
