import { Outlet, createRootRoute } from "@tanstack/react-router";
import * as RadixTooltip from "@radix-ui/react-tooltip";

import { AuthGate } from "../components/layout/AuthGate.tsx";
import { Sidebar } from "../components/layout/Sidebar.tsx";
import { ToastProvider } from "../components/ui/toast.tsx";

export const Route = createRootRoute({
  component: () => (
    <ToastProvider>
      <RadixTooltip.Provider delayDuration={200}>
        <AuthGate>
          <div className="flex h-screen bg-background overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto px-8 py-6">
              <Outlet />
            </main>
          </div>
        </AuthGate>
      </RadixTooltip.Provider>
    </ToastProvider>
  ),
});
