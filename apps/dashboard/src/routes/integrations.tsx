import * as React from "react";
import { createRoute, useNavigate, useSearch } from "@tanstack/react-router";

import { PageContainer } from "../components/layout/PageContainer.tsx";
import { PageHeader } from "../components/ui/page-header.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";

import { McpPageBody } from "./mcp.tsx";
import { PluginsPage } from "./plugins.tsx";
import { Route as RootRoute } from "./__root.tsx";

type IntegrationsTab = "mcp" | "plugins";

interface IntegrationsSearch {
  tab: IntegrationsTab;
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/integrations",
  component: IntegrationsPage,
  validateSearch: (raw): IntegrationsSearch => ({
    tab: raw.tab === "plugins" ? "plugins" : "mcp",
  }),
});

function IntegrationsPage(): React.JSX.Element {
  const { tab } = useSearch({ from: "/integrations" });
  const navigate = useNavigate();
  const setTab = (v: string) =>
    navigate({ to: "/integrations", search: { tab: v as IntegrationsTab } });

  return (
    <PageContainer>
      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <PageHeader
          title="Integrations"
          description="External tools wired into the agent runtime."
          tabs={
            <TabsList>
              <TabsTrigger value="mcp">MCP</TabsTrigger>
              <TabsTrigger value="plugins">Plugins</TabsTrigger>
            </TabsList>
          }
        />
        <TabsContent value="mcp">
          <McpPageBody />
        </TabsContent>
        <TabsContent value="plugins">
          <PluginsPage />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
