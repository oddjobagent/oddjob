// @oddjob/plugin-env-daytona — Daytona remote-VM environment plugin.
//
// Trust tier: remote-vm. Sandboxes run on Daytona's Firecracker fleet with
// snapshot/fork/exposePort/pauseResume capabilities. Auth via the
// DAYTONA_API_KEY credential (`oddjob env credential add daytona ...`).

import { Type } from "typebox";

import type { EnvironmentProvider, ProviderCredential } from "@oddjob/core";
import { definePlugin } from "@oddjob/sdk";

import { DaytonaEnvironmentProvider } from "./provider.ts";

export { DaytonaEnvironmentProvider, DaytonaEnvironmentSession } from "./provider.ts";

const authSchema = Type.Object({
  apiKey: Type.String({ minLength: 20, description: "Daytona API key (dtn_...)" }),
});

export default definePlugin(
  {
    slug: "env-daytona",
    name: "Daytona environment",
    description:
      "Remote-VM environment backed by Daytona Firecracker sandboxes. Capabilities: snapshot, fork, pause/resume, preview URLs.",
    version: "0.1.0",
    author: "Oddjob",
    homepage: "https://www.daytona.io/",
  },
  (b) =>
    b.environment({
      id: "daytona",
      displayName: "Daytona",
      trustTier: "remote-vm",
      authHint: "DAYTONA_API_KEY (set via 'oddjob env credential add daytona --api-key dtn_...')",
      authSchema,
      capabilities: {
        snapshot: true,
        fork: true,
        pauseResume: true,
        exposePort: true,
        // Daytona supports IPv4 CIDR allowlists at the network layer; for
        // hostname allowlisting we rely on the credential-broker proxy at
        // the agent layer. Reflect that honestly.
        egressAllowlist: false,
        packageManagers: ["apt", "pip", "npm"],
      },
      available: async (credential?: ProviderCredential) => {
        if (!credential?.apiKey) {
          return { ok: false, reason: "no DAYTONA_API_KEY credential configured" };
        }
        try {
          // Lightest-weight ping the SDK exposes is constructing the client
          // and listing sandboxes (paginated, limit=1). The constructor
          // doesn't make a network call so we have to issue something.
          const { Daytona } = await import("@daytonaio/sdk");
          const client = new Daytona({ apiKey: credential.apiKey });
          // The SDK exposes a paginated list; calling it with a small limit
          // verifies auth without enumerating anything heavy.
          const list =
            (
              client as unknown as {
                list?: () => Promise<unknown>;
                sandbox?: { list: (params?: { limit?: number }) => Promise<unknown> };
              }
            ).list ??
            (
              client as unknown as {
                sandbox?: { list: (params?: { limit?: number }) => Promise<unknown> };
              }
            ).sandbox?.list;
          if (typeof list === "function") {
            await list.call(client, { limit: 1 });
          }
          return { ok: true };
        } catch (err) {
          return { ok: false, reason: (err as Error).message ?? "Daytona ping failed" };
        }
      },
      create: (credential?: ProviderCredential): EnvironmentProvider => {
        if (!credential?.apiKey) {
          throw new Error(
            "env-daytona: no API key in credential; run `oddjob env credential add daytona --api-key dtn_...`",
          );
        }
        return new DaytonaEnvironmentProvider({
          apiKey: credential.apiKey,
          ...(credential.baseUrl ? { baseUrl: credential.baseUrl } : {}),
        });
      },
    }),
);
