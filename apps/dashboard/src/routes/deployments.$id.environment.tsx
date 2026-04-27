import * as React from "react";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";

import type { Environment } from "@oddjob/core";
import type {
  DeploymentEnvironmentInline,
  EnvironmentProviderDescriptor,
} from "@oddjob/api-client";

import {
  useDeployment,
  useDeploymentEnvironment,
  useEngine,
  useEnvironmentProviders,
  useEnvironments,
} from "../api/queries.ts";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Field } from "../components/ui/form.tsx";
import { Input } from "../components/ui/input.tsx";
import { useToast } from "../components/ui/toast.tsx";
import { TrustTierBadge } from "../components/environments/TrustTierBadge.tsx";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/deployments/$id/environment",
  component: DeploymentEnvironmentPage,
});

type Mode = "engine-default" | "ref" | "inline";

function DeploymentEnvironmentPage(): React.JSX.Element {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const dep = useDeployment(id);
  const envs = useEnvironments();
  const providers = useEnvironmentProviders();
  const engine = useEngine();
  const update = useDeploymentEnvironment(id);

  const [mode, setMode] = React.useState<Mode | null>(null);
  const [refId, setRefId] = React.useState<string>("");
  const [allowedHosts, setAllowedHosts] = React.useState<string>("");
  const [cpu, setCpu] = React.useState<string>("");
  const [memMb, setMemMb] = React.useState<string>("");

  React.useEffect(() => {
    if (mode === null && dep.data) {
      const initial: Mode = dep.data.environmentInline
        ? "inline"
        : dep.data.environmentId
          ? "ref"
          : "engine-default";
      setMode(initial);
      setRefId(dep.data.environmentId ?? "");
      const inline = dep.data.environmentInline;
      const networking = inline?.networking;
      if (networking && networking.type === "limited") {
        setAllowedHosts((networking.allowedHosts ?? []).join(", "));
      }
      setCpu(inline?.resources?.cpu != null ? String(inline.resources.cpu) : "");
      setMemMb(inline?.resources?.memMb != null ? String(inline.resources.memMb) : "");
    }
  }, [dep.data, mode]);

  if (dep.isLoading || mode === null) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }
  if (!dep.data) {
    return <div className="text-sm text-muted-foreground">Deployment not found.</div>;
  }

  const engineDefaultId = engine.data?.defaultEnvironmentId ?? null;
  const providerIndex = new Map<string, EnvironmentProviderDescriptor>(
    providers.data?.providers.map((p) => [p.id, p]) ?? [],
  );
  const envIndex = new Map<string, Environment>(
    envs.data?.environments.map((e) => [e.id, e]) ?? [],
  );

  const submit = async () => {
    try {
      if (mode === "engine-default") {
        await update.mutateAsync({ kind: "engine-default" });
      } else if (mode === "ref") {
        if (!refId) {
          toast.push("error", "Pick an environment");
          return;
        }
        await update.mutateAsync({ kind: "ref", environmentId: refId });
      } else {
        // Inline mode: preserve all rich fields the form doesn't expose
        // (provider, image, packages, diskMb, template, type, ...) by
        // merging onto the existing inline rather than replacing it.
        const existing = dep.data?.environmentInline ?? {};
        const inline = mergeInline(existing, { allowedHosts, cpu, memMb }, !refId);
        if (!inline) {
          toast.push("error", "Inline override is empty — pick at least one field or switch modes");
          return;
        }
        if (refId) {
          await update.mutateAsync({
            kind: "ref-with-override",
            environmentId: refId,
            environmentInline: inline,
          });
        } else {
          await update.mutateAsync({ kind: "inline", environmentInline: inline });
        }
      }
      toast.push("success", "Environment updated");
      navigate({ to: "/deployments/$id", params: { id } });
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <Link
          to="/deployments/$id"
          params={{ id }}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← {dep.data.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Environment</h1>
        <p className="text-sm text-muted-foreground">
          Pick the execution environment for this deployment. Future runs use the new selection;
          in-flight runs keep the snapshot from when they were dispatched.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Selection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium mb-1">Source</legend>
            <ModeRadio
              checked={mode === "engine-default"}
              onChange={() => setMode("engine-default")}
              label="Use engine default"
              hint={
                engineDefaultId
                  ? `Currently: ${engineDefaultId}`
                  : "No engine default set — falls through to the platform hard default"
              }
            />
            <ModeRadio
              checked={mode === "ref"}
              onChange={() => setMode("ref")}
              label="Reference a stored environment"
              hint="Pick from the environments list. Reusable across deployments."
            />
            <ModeRadio
              checked={mode === "inline"}
              onChange={() => setMode("inline")}
              label="Inline override"
              hint="One-off — overlays selected fields onto the referenced environment (or fully inline if no reference)."
            />
          </fieldset>

          {mode === "ref" || mode === "inline" ? (
            <Field
              label={<label htmlFor="env-ref">Environment</label>}
              helper={
                mode === "inline"
                  ? "Optional. Leave blank to inline-only; otherwise inline fields overlay this base."
                  : undefined
              }
            >
              <select
                id="env-ref"
                value={refId}
                onChange={(e) => setRefId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                <option value="">{mode === "inline" ? "(fully inline)" : "— pick one —"}</option>
                {envs.data?.environments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.id}
                    {e.config.provider?.service ? ` · ${e.config.provider.service}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {mode === "inline" ? (
            <div className="space-y-3 rounded-md border p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Inline overrides
              </div>
              {hasRichInlineFields(dep.data.environmentInline) ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                  <div className="font-medium text-amber-700">Rich inline config preserved</div>
                  <div className="text-muted-foreground mt-0.5">
                    This deployment carries inline fields beyond what this form exposes (
                    {richInlineFieldNames(dep.data.environmentInline).join(", ")}). They will be
                    kept as-is on save. Edit raw config via{" "}
                    <code className="font-mono">deploy.toml</code>.
                  </div>
                </div>
              ) : null}
              <Field
                label={<label htmlFor="allowed-hosts">Allowed hosts</label>}
                helper="Comma-separated. Concat-merged onto the referenced environment's allowed_hosts."
              >
                <Input
                  id="allowed-hosts"
                  value={allowedHosts}
                  onChange={(e) => setAllowedHosts(e.target.value)}
                  placeholder="api.example.com, hooks.slack.com"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={<label htmlFor="cpu">CPU</label>}>
                  <Input
                    id="cpu"
                    type="number"
                    min="0"
                    value={cpu}
                    onChange={(e) => setCpu(e.target.value)}
                    placeholder="2"
                  />
                </Field>
                <Field label={<label htmlFor="mem">Memory (MB)</label>}>
                  <Input
                    id="mem"
                    type="number"
                    min="0"
                    value={memMb}
                    onChange={(e) => setMemMb(e.target.value)}
                    placeholder="2048"
                  />
                </Field>
              </div>
            </div>
          ) : null}

          {(mode === "ref" || mode === "inline") && refId ? (
            <SelectedEnvironmentPreview env={envIndex.get(refId)} providerIndex={providerIndex} />
          ) : null}

          <div className="flex items-center gap-2 pt-2 border-t">
            <Button onClick={submit} disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate({ to: "/deployments/$id", params: { id } })}
              disabled={update.isPending}
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ModeRadio({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  hint: string;
}): React.JSX.Element {
  return (
    <label className="flex items-start gap-3 cursor-pointer rounded-md border p-3 hover:bg-accent/50">
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="mt-0.5"
        name="env-mode"
      />
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
    </label>
  );
}

function SelectedEnvironmentPreview({
  env,
  providerIndex,
}: {
  env: Environment | undefined;
  providerIndex: Map<string, EnvironmentProviderDescriptor>;
}): React.JSX.Element {
  if (!env) {
    return (
      <div className="text-xs text-muted-foreground">Selected environment not found locally.</div>
    );
  }
  const svc = env.config.provider?.service;
  const tier = svc ? providerIndex.get(svc)?.trustTier : undefined;
  return (
    <div className="rounded-md bg-muted/30 p-3 text-xs space-y-1">
      <div className="font-medium uppercase tracking-wide text-muted-foreground">Preview</div>
      <div className="flex items-center gap-2">
        <span>Provider:</span>
        <span className="font-mono">{svc ?? "(engine default)"}</span>
        {tier ? <TrustTierBadge tier={tier} /> : null}
      </div>
    </div>
  );
}

const FORM_INLINE_KEYS = new Set(["networking", "resources"]);

function richInlineFieldNames(inline: DeploymentEnvironmentInline | undefined): string[] {
  if (!inline) return [];
  return Object.keys(inline).filter((k) => !FORM_INLINE_KEYS.has(k));
}

function hasRichInlineFields(inline: DeploymentEnvironmentInline | undefined): boolean {
  return richInlineFieldNames(inline).length > 0;
}

/**
 * Merge form-driven overrides onto the existing inline. The form only exposes
 * `networking.allowedHosts` + `resources.{cpu,memMb}`; every other field on
 * the existing inline (`provider`, `image`, `packages`, `template`,
 * `workingDir`, `resources.diskMb`, networking modes other than `limited`,
 * etc.) is preserved verbatim. When fully inline (no referenced env), the
 * resolver requires `type` — default to "local" if the existing inline
 * doesn't already set it.
 */
function mergeInline(
  existing: DeploymentEnvironmentInline,
  form: { allowedHosts: string; cpu: string; memMb: string },
  fullyInline: boolean,
): DeploymentEnvironmentInline | null {
  const next: DeploymentEnvironmentInline = { ...existing };

  const hosts = form.allowedHosts
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (hosts.length > 0) {
    next.networking = { type: "limited", allowedHosts: hosts };
  } else if (existing.networking?.type === "limited") {
    // Form cleared — drop the networking override; resolver inherits base.
    const { networking: _drop, ...rest } = next;
    Object.assign(next, rest);
    delete (next as { networking?: unknown }).networking;
  }

  const cpuNum = form.cpu ? Number(form.cpu) : null;
  const memNum = form.memMb ? Number(form.memMb) : null;
  const resources: { cpu?: number; memMb?: number; diskMb?: number } = {
    ...(existing.resources ?? {}),
  };
  if (cpuNum != null && Number.isFinite(cpuNum)) resources.cpu = cpuNum;
  else delete resources.cpu;
  if (memNum != null && Number.isFinite(memNum)) resources.memMb = memNum;
  else delete resources.memMb;
  if (Object.keys(resources).length > 0) next.resources = resources;
  else delete (next as { resources?: unknown }).resources;

  if (fullyInline && !next.type) next.type = "local";

  return Object.keys(next).length > 0 ? next : null;
}
