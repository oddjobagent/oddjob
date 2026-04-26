import { Link } from "@tanstack/react-router";
import { Activity, Box, FileCog, Key, LayoutDashboard, ServerCog } from "lucide-react";

import { cn } from "@/lib/utils.ts";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/runs", label: "Runs", icon: Activity },
  { to: "/deployments", label: "Deployments", icon: ServerCog },
  { to: "/blueprints", label: "Blueprints", icon: Box },
  { to: "/secrets", label: "Secrets", icon: Key },
] as const;

export function Sidebar(): React.JSX.Element {
  return (
    <aside className="flex h-screen w-56 flex-col border-r bg-card">
      <div className="flex items-center gap-2 px-6 py-5 border-b">
        <FileCog className="size-5" />
        <span className="font-semibold tracking-tight">Oddjob</span>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            activeProps={{ className: "bg-accent text-accent-foreground" }}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="px-6 py-4 text-xs text-muted-foreground border-t">v0.0.0 · pre-alpha</div>
    </aside>
  );
}
