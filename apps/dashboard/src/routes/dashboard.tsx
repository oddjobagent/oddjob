import { createRoute } from "@tanstack/react-router";

import { Route as RootRoute } from "./__root.tsx";
// Reuse the Overview component used at "/"; this route is a deep-link alias
// so users can bookmark http://host:7777/dashboard.
import { Overview } from "./index.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/dashboard",
  component: Overview,
});
