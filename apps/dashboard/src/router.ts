import { createRoute, createRouter, redirect } from "@tanstack/react-router";

import { Route as rootRoute } from "./routes/__root.tsx";
import { Route as indexRoute } from "./routes/index.tsx";
import { Route as dashboardAliasRoute } from "./routes/dashboard.tsx";
import { Route as runsRoute } from "./routes/runs.tsx";
import { Route as runDetailRoute } from "./routes/runs.$id.tsx";
import { Route as deploymentsRoute } from "./routes/deployments.tsx";
import { Route as deploymentDetailRoute } from "./routes/deployments.$id.tsx";
import { Route as deploymentNewRoute } from "./routes/deployments.new.tsx";
import { Route as deploymentEditRoute } from "./routes/deployments.$id.edit.tsx";
import { Route as blueprintsRoute } from "./routes/blueprints.tsx";
import { Route as blueprintDetailRoute } from "./routes/blueprints.$id.tsx";
import { Route as channelsRoute } from "./routes/channels.tsx";
import { Route as environmentsRoute } from "./routes/environments.tsx";
import { Route as environmentProvidersRoute } from "./routes/environments.providers.tsx";
import { Route as deploymentEnvironmentRoute } from "./routes/deployments.$id.environment.tsx";
import { Route as modelsRoute } from "./routes/models.tsx";
import { Route as integrationsRoute } from "./routes/integrations.tsx";
import { Route as settingsRoute } from "./routes/settings.tsx";

// Old paths now redirect to their new homes. We keep these as their own Route
// declarations (instead of mounting the old route files) so a single page owns
// each new path.
const Empty = (): null => null;

function makeRedirect(path: string, target: () => never) {
  return createRoute({
    getParentRoute: () => rootRoute,
    path,
    beforeLoad: () => {
      target();
    },
    component: Empty,
  });
}

const providersRedirect = makeRedirect("/providers", () => {
  throw redirect({ to: "/models" });
});
const mcpRedirect = makeRedirect("/mcp", () => {
  throw redirect({ to: "/integrations", search: { tab: "mcp" as const } });
});
const pluginsRedirect = makeRedirect("/plugins", () => {
  throw redirect({ to: "/integrations", search: { tab: "plugins" as const } });
});
const engineRedirect = makeRedirect("/engine", () => {
  throw redirect({ to: "/settings", search: { tab: "engine" as const } });
});
const secretsRedirect = makeRedirect("/secrets", () => {
  throw redirect({ to: "/settings", search: { tab: "secrets" as const } });
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  dashboardAliasRoute,
  runsRoute,
  runDetailRoute,
  deploymentsRoute,
  deploymentNewRoute,
  deploymentEditRoute,
  deploymentEnvironmentRoute,
  deploymentDetailRoute,
  blueprintsRoute,
  blueprintDetailRoute,
  channelsRoute,
  environmentsRoute,
  environmentProvidersRoute,
  modelsRoute,
  integrationsRoute,
  settingsRoute,
  providersRedirect,
  mcpRedirect,
  pluginsRedirect,
  engineRedirect,
  secretsRedirect,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
