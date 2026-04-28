import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { Container } from "@oddjob/ui";
import { DocsSidebar } from "~/components/site/docs-sidebar.tsx";

export const Route = createFileRoute("/docs")({
  component: DocsLayout,
});

function DocsLayout() {
  const params = useParams({ strict: false });
  const splat = (params as { _splat?: string })._splat;
  return (
    <Container size="xl" className="py-12">
      <div className="grid gap-10 lg:grid-cols-[14rem_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
          <DocsSidebar currentSlug={splat} />
        </aside>
        <div className="min-w-0 max-w-3xl">
          <Outlet />
        </div>
      </div>
    </Container>
  );
}
