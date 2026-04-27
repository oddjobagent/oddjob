import * as React from "react";
import { createRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, XCircle } from "lucide-react";

import type { EnvironmentProviderDescriptor } from "@oddjob/api-client";

import {
  useEnvironmentProviders,
  useProvider,
  useProviderMutations,
} from "../api/queries.ts";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Input } from "../components/ui/input.tsx";
import { TrustTierBadge } from "../components/environments/TrustTierBadge.tsx";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/environments/providers",
  component: EnvironmentProviders,
});

function EnvironmentProviders(): React.JSX.Element {
  const { data, isLoading } = useEnvironmentProviders();

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link to="/environments" className="text-xs text-muted-foreground hover:underline">
            ← Environments
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">Environment providers</h1>
          <p className="text-sm text-muted-foreground">
            Registered environment services from installed plugins. Trust tier and capability badges
            show what each backend supports. Remote providers need credentials configured below.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Installed providers</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : data?.providers.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No environment providers registered. Install the bundled plugins or drop one in{" "}
              <code className="font-mono text-xs">~/.oddjob/plugins/</code>.
            </div>
          ) : (
            <ul className="space-y-3">
              {data?.providers.map((p) => (
                <ProviderRow key={p.id} provider={p} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProviderRow({ provider }: { provider: EnvironmentProviderDescriptor }): React.JSX.Element {
  const isRemote = provider.trustTier === "remote-vm";
  return (
    <li className="border-b last:border-b-0 pb-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm">{provider.id}</span>
            <span className="text-sm text-muted-foreground">{provider.displayName}</span>
            <TrustTierBadge tier={provider.trustTier} />
            <AvailabilityIndicator available={provider.available} />
          </div>
          {provider.authHint ? (
            <p className="mt-1 text-xs text-muted-foreground">{provider.authHint}</p>
          ) : null}
          <CapabilityBadges caps={provider.capabilities} />
        </div>
      </div>
      {isRemote ? <CredentialEditor providerId={provider.id} /> : null}
    </li>
  );
}

function AvailabilityIndicator({
  available,
}: {
  available: { ok: boolean; reason?: string };
}): React.JSX.Element {
  if (available.ok) {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700" title="Provider is ready to use">
        <CheckCircle2 className="size-3 mr-1" /> ok
      </Badge>
    );
  }
  return (
    <Badge
      className="bg-red-500/15 text-red-700"
      title={available.reason ?? "Provider is not available on this host"}
    >
      <XCircle className="size-3 mr-1" /> unavailable
    </Badge>
  );
}

function CapabilityBadges({
  caps,
}: {
  caps: EnvironmentProviderDescriptor["capabilities"];
}): React.JSX.Element {
  const flags: Array<[string, boolean]> = [
    ["snapshot", caps.snapshot],
    ["fork", caps.fork],
    ["pause/resume", caps.pauseResume],
    ["expose-port", caps.exposePort],
    ["egress allowlist", caps.egressAllowlist],
  ];
  return (
    <div className="mt-2 flex gap-1 flex-wrap">
      {flags
        .filter(([, ok]) => ok)
        .map(([name]) => (
          <Badge key={name} className="bg-muted text-muted-foreground text-xs">
            {name}
          </Badge>
        ))}
      {caps.packageManagers.length > 0 ? (
        <Badge className="bg-muted text-muted-foreground text-xs">
          pm: {caps.packageManagers.join(",")}
        </Badge>
      ) : null}
    </div>
  );
}

/**
 * Remote env-providers reuse the model-provider credential machinery — the
 * `provider_credentials` table is keyed by `(provider_slug, credential_name)`
 * and accepts ANY slug (env service or model provider). We render the editor
 * unconditionally for any remote-vm service; the optional `useProvider` lookup
 * only powers the "credential set" indicator.
 */
function CredentialEditor({ providerId }: { providerId: string }): React.JSX.Element {
  const detail = useProvider(providerId);
  const { upsertCredential } = useProviderMutations();
  const [apiKey, setApiKey] = React.useState("");

  const existing = detail.data?.credentials.find((c) => c.credentialName === "default");

  return (
    <div className="mt-3 rounded-md border bg-muted/20 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        Credential
      </div>
      <form
        className="flex gap-2 items-center flex-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          if (apiKey)
            upsertCredential.mutate(
              { slug: providerId, input: { apiKey } },
              { onSuccess: () => setApiKey("") },
            );
        }}
      >
        <Input
          type="password"
          placeholder={existing ? "Replace API key" : "Paste API key"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="flex-1 max-w-md"
          aria-label={`API key for ${providerId}`}
        />
        <Button type="submit" disabled={!apiKey || upsertCredential.isPending}>
          {upsertCredential.isPending ? "Saving…" : existing ? "Replace" : "Save key"}
        </Button>
        {existing ? <span className="text-xs text-muted-foreground">credential set</span> : null}
      </form>
    </div>
  );
}
