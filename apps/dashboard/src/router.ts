import { createRouter } from "@tanstack/react-router";

import { Route as rootRoute } from "./routes/__root.tsx";
import { Route as indexRoute } from "./routes/index.tsx";
import { Route as dashboardAliasRoute } from "./routes/dashboard.tsx";
import { Route as runsRoute } from "./routes/runs.tsx";
import { Route as runDetailRoute } from "./routes/runs.$id.tsx";
import { Route as deploymentsRoute } from "./routes/deployments.tsx";
import { Route as deploymentDetailRoute } from "./routes/deployments.$id.tsx";
import { Route as blueprintsRoute } from "./routes/blueprints.tsx";
import { Route as blueprintDetailRoute } from "./routes/blueprints.$id.tsx";
import { Route as secretsRoute } from "./routes/secrets.tsx";

const routeTree = rootRoute.addChildren([
  indexRoute,
  dashboardAliasRoute,
  runsRoute,
  runDetailRoute,
  deploymentsRoute,
  deploymentDetailRoute,
  blueprintsRoute,
  blueprintDetailRoute,
  secretsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
