import * as React from "react";
import { createRoute, useNavigate, useSearch } from "@tanstack/react-router";

import { PageContainer } from "../components/layout/PageContainer.tsx";
import { PageHeader } from "../components/ui/page-header.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";

import { EnginePageBody, ServerSettingsBody } from "./engine.tsx";
import { Route as RootRoute } from "./__root.tsx";
import { SecretsPage } from "./secrets.tsx";

type SettingsTab = "engine" | "secrets" | "server";

interface SettingsSearch {
  tab: SettingsTab;
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/settings",
  component: SettingsPage,
  validateSearch: (raw): SettingsSearch => ({
    tab: raw.tab === "secrets" ? "secrets" : raw.tab === "server" ? "server" : "engine",
  }),
});

function SettingsPage(): React.JSX.Element {
  const { tab } = useSearch({ from: "/settings" });
  const navigate = useNavigate();
  const setTab = (v: string) => navigate({ to: "/settings", search: { tab: v as SettingsTab } });

  return (
    <PageContainer>
      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <PageHeader
          title="Settings"
          description="Server configuration, agent engine, and secrets."
          tabs={
            <TabsList>
              <TabsTrigger value="engine">Engine</TabsTrigger>
              <TabsTrigger value="secrets">Secrets</TabsTrigger>
              <TabsTrigger value="server">Server</TabsTrigger>
            </TabsList>
          }
        />
        <TabsContent value="engine">
          <EnginePageBody />
        </TabsContent>
        <TabsContent value="secrets">
          <SecretsPage />
        </TabsContent>
        <TabsContent value="server">
          <ServerSettingsBody />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
