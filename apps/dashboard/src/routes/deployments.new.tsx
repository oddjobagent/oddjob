import * as React from "react";
import { createRoute, useNavigate, useSearch } from "@tanstack/react-router";

import { useDeploymentLifecycle } from "../api/queries.ts";
import {
  DeploymentForm,
  emptyFormState,
  formStateToInput,
  type DeploymentFormState,
} from "../components/deployments/DeploymentForm.tsx";
import { Button } from "../components/ui/button.tsx";
import { useToast } from "../components/ui/toast.tsx";

import { Route as RootRoute } from "./__root.tsx";

interface NewSearch {
  blueprint?: string;
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/deployments/new",
  component: NewDeploymentPage,
  validateSearch: (raw): NewSearch => ({
    blueprint: typeof raw.blueprint === "string" ? raw.blueprint : undefined,
  }),
});

function NewDeploymentPage(): React.JSX.Element {
  const search = useSearch({ from: "/deployments/new" }) as NewSearch;
  const navigate = useNavigate();
  const lifecycle = useDeploymentLifecycle();
  const toast = useToast();

  const [state, setState] = React.useState<DeploymentFormState>(() => ({
    ...emptyFormState(),
    blueprintId: search.blueprint ?? "",
  }));
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!state.blueprintId) return setError("Pick a blueprint");
    if (!state.name) return setError("Name is required");
    try {
      const created = await lifecycle.create.mutateAsync(formStateToInput(state));
      toast.push("success", `Deployed ${created.name}`);
      navigate({ to: "/deployments/$id", params: { id: created.id } });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">New deployment</h1>
        <p className="text-sm text-muted-foreground">
          Bind a blueprint to a model, budget, triggers, and channels.
        </p>
      </header>
      <DeploymentForm state={state} onChange={setState} />
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 sticky bottom-0 bg-background/90 backdrop-blur py-3 border-t">
        <Button onClick={submit} disabled={lifecycle.create.isPending}>
          {lifecycle.create.isPending ? "Deploying…" : "Deploy"}
        </Button>
        <Button
          variant="outline"
          onClick={() => navigate({ to: "/deployments" })}
          disabled={lifecycle.create.isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
