import { createRoute } from "@tanstack/react-router";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/blueprints/$id",
  component: () => (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">Blueprint detail</h1>
      <p className="text-sm text-muted-foreground">Coming in Phase 13d.</p>
    </div>
  ),
});
