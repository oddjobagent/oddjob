import * as React from "react";
import { createRoute, useNavigate, useParams } from "@tanstack/react-router";

import { useDeployment, useDeploymentLifecycle } from "../api/queries.ts";
import {
  DeploymentForm,
  emptyFormState,
  formStateToInput,
  type DeploymentFormState,
} from "../components/deployments/DeploymentForm.tsx";
import { Button } from "../components/ui/button.tsx";
import { useToast } from "../components/ui/toast.tsx";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/deployments/$id/edit",
  component: EditDeploymentPage,
});

function EditDeploymentPage(): React.JSX.Element {
  const { id } = useParams({ from: "/deployments/$id/edit" });
  const dep = useDeployment(id);
  const navigate = useNavigate();
  const lifecycle = useDeploymentLifecycle();
  const toast = useToast();
  const [state, setState] = React.useState<DeploymentFormState | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (dep.data && !state) {
      setState({
        ...emptyFormState(),
        blueprintId: dep.data.blueprintId,
        name: dep.data.name,
        modelOverride: dep.data.modelOverride ?? "",
        triggers: dep.data.triggers.length > 0 ? dep.data.triggers : [{ type: "manual" }],
        channels: dep.data.channels.length > 0 ? dep.data.channels : [{ type: "console" }],
        limits: dep.data.limits,
        defaultInput: dep.data.defaultInput,
      });
    }
  }, [dep.data, state]);

  if (!state) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const submit = async () => {
    setError(null);
    try {
      const updated = await lifecycle.update.mutateAsync({
        id,
        patch: formStateToInput(state),
      });
      toast.push("success", `Updated ${updated.name}`);
      navigate({ to: "/deployments/$id", params: { id: updated.id } });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Edit {state.name}</h1>
        <p className="text-sm text-muted-foreground">
          Changes apply to future runs. In-flight runs keep their existing config.
        </p>
      </header>
      <DeploymentForm state={state} onChange={setState} lockIdentity />
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 sticky bottom-0 bg-background/90 backdrop-blur py-3 border-t">
        <Button onClick={submit} disabled={lifecycle.update.isPending}>
          {lifecycle.update.isPending ? "Saving…" : "Save"}
        </Button>
        <Button
          variant="outline"
          onClick={() => navigate({ to: "/deployments/$id", params: { id } })}
          disabled={lifecycle.update.isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
