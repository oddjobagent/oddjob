import { createRoute } from "@tanstack/react-router";

import { ProvidersPage } from "./providers.tsx";
import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/models",
  component: ProvidersPage,
});
