import { createRouter } from "@tanstack/react-router";

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
import { Route as engineRoute } from "./routes/engine.tsx";
import { Route as environmentsRoute } from "./routes/environments.tsx";
import { Route as environmentProvidersRoute } from "./routes/environments.providers.tsx";
import { Route as deploymentEnvironmentRoute } from "./routes/deployments.$id.environment.tsx";
import { Route as mcpRoute } from "./routes/mcp.tsx";
import { Route as pluginsRoute } from "./routes/plugins.tsx";
import { Route as providersRoute } from "./routes/providers.tsx";
import { Route as secretsRoute } from "./routes/secrets.tsx";

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
  engineRoute,
  environmentsRoute,
  environmentProvidersRoute,
  mcpRoute,
  pluginsRoute,
  providersRoute,
  secretsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
