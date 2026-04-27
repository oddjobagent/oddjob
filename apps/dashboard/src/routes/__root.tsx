import { Outlet, createRootRoute } from "@tanstack/react-router";

import { AuthGate } from "../components/layout/AuthGate.tsx";
import { Sidebar } from "../components/layout/Sidebar.tsx";
import { ToastProvider } from "../components/ui/toast.tsx";

export const Route = createRootRoute({
  component: () => (
    <ToastProvider>
      <AuthGate>
        <div className="flex min-h-screen bg-background">
          <Sidebar />
          <main className="flex-1 overflow-auto">
            <div className="mx-auto max-w-7xl p-8">
              <Outlet />
            </div>
          </main>
        </div>
      </AuthGate>
    </ToastProvider>
  ),
});
