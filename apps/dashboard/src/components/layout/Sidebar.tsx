import { Link } from "@tanstack/react-router";
import {
  Activity,
  Box,
  Boxes,
  ChevronsUpDown,
  Cpu,
  FileCog,
  Inbox,
  LayoutDashboard,
  Plug,
  ServerCog,
  SettingsIcon,
} from "lucide-react";

import { useHealth } from "../../api/queries.ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import { Tooltip } from "../ui/tooltip.tsx";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Operational",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard, exact: true },
      { to: "/runs", label: "Runs", icon: Activity },
      { to: "/deployments", label: "Deployments", icon: ServerCog },
    ],
  },
  {
    title: "Catalog",
    items: [
      { to: "/blueprints", label: "Blueprints", icon: Box },
      { to: "/models", label: "Models", icon: Cpu },
      { to: "/channels", label: "Channels", icon: Inbox },
    ],
  },
  {
    title: "Configuration",
    items: [
      { to: "/integrations", label: "Integrations", icon: Plug },
      { to: "/environments", label: "Environments", icon: Boxes },
      { to: "/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
];

function HealthDot(): React.JSX.Element {
  const q = useHealth();
  const ok = q.data?.ok === true;
  const tone = q.isError ? "danger" : ok ? "success" : "warn";
  const label = q.isError
    ? "API unreachable"
    : ok
      ? "Healthy"
      : q.isLoading
        ? "Connecting…"
        : "Degraded";
  return (
    <Tooltip content={label} side="right">
      <span
        className="inline-block size-1.5 rounded-full"
        data-tone={tone}
        style={{
          backgroundColor:
            tone === "success"
              ? "var(--success-9)"
              : tone === "danger"
                ? "var(--danger-9)"
                : "var(--warn-9)",
        }}
      />
    </Tooltip>
  );
}

function WorkspaceSwitcher(): React.JSX.Element {
  const origin = typeof window !== "undefined" ? window.location.host : "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="group flex w-full items-center gap-2 rounded-md border border-(--border-subtle) bg-(--surface-1) px-2 py-1.5 text-left transition-colors hover:bg-(--surface-2) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <FileCog className="size-4 text-(--accent-9)" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold tracking-(--tracking-snug) text-(--text)">
            Oddjob
          </div>
          <div className="truncate text-[10px] text-(--text-muted)">{origin || "local"}</div>
        </div>
        <ChevronsUpDown className="size-3 text-(--text-muted) group-hover:text-(--text)" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel>Workspace</DropdownMenuLabel>
        <DropdownMenuItem className="flex-col items-start">
          <div className="text-sm font-medium">Local</div>
          <div className="text-xs text-(--text-muted)">{origin}</div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Connect remote API…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Sidebar(): React.JSX.Element {
  const health = useHealth();
  const ok = health.data?.ok === true;
  const status = health.isError
    ? "unreachable"
    : ok
      ? "healthy"
      : health.isLoading
        ? "connecting"
        : "degraded";

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-(--border-subtle) bg-(--surface-1)">
      <div className="px-3 pt-3 pb-4">
        <WorkspaceSwitcher />
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-2 pb-4">
        {GROUPS.map((group) => (
          <div key={group.title} className="space-y-0.5">
            <div className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-widest text-(--text-subtle)">
              {group.title}
            </div>
            {group.items.map(({ to, label, icon: Icon, exact }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: !!exact }}
                className="group flex h-7 items-center gap-2.5 rounded-md border-l-2 border-transparent px-2.5 text-[13px] font-medium text-(--text-muted) transition-colors hover:bg-(--surface-2) hover:text-(--text)"
                activeProps={{
                  className: "border-(--accent-9) text-(--text) bg-(--accent-3)/30",
                }}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t border-(--border-subtle) px-3 py-2.5">
        <div className="flex items-center justify-between text-[10px] text-(--text-muted)">
          <span className="font-mono">v0.0.0</span>
          <span className="flex items-center gap-1.5">
            <HealthDot />
            <span className="capitalize">{status}</span>
          </span>
        </div>
      </div>
    </aside>
  );
}
