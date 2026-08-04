"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROUTES, ROUTE_GROUPS } from "@/lib/routes";
import { useSidebar } from "@/components/layout/sidebar-context";

const GROUP_LABELS: Record<string, string> = {
  overview: "Overview",
  activity: "Activity",
  sessions: "Sessions",
  projects: "Projects",
  tools: "Tools",
  todos: "Todos",
  costs: "Costs",
  agents: "Agents",
  export: "Export",
  settings: "Settings",
};

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggleCollapsed } = useSidebar();

  return (
    <aside
      data-slot="sidebar"
      className={cn(
        "hidden md:sticky md:top-0 md:flex md:h-screen md:flex-col md:shrink-0 md:border-r md:border-border md:bg-surface md:transition-[width] md:duration-150",
        collapsed ? "md:w-14" : "md:w-56",
      )}
    >
      <div className={cn("flex h-16 items-center gap-3 border-b border-border px-3", collapsed && "justify-center px-0")}>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Activity aria-hidden="true" className="size-4" />
        </div>
        {!collapsed && <div className="min-w-0"><p className="font-display text-sm font-semibold tracking-tight">oc-lens</p><p className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">signal desk</p></div>}
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        {ROUTE_GROUPS.map((group) => {
          const groupRoutes = ROUTES.filter((route) => route.group === group);
          if (groupRoutes.length === 0) return null;
          return (
            <div key={group} className="mb-4">
              {!collapsed && groupRoutes.length > 1 && (
                <div className="px-2 pb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {GROUP_LABELS[group] ?? group}
                </div>
              )}
              {groupRoutes.map((route) => {
                const Icon = route.icon;
                const isActive = route.enabled && (route.href === "/" ? pathname === "/" : pathname.startsWith(route.href));
                if (!route.enabled) {
                  return (
                    <div
                      key={route.href}
                      aria-disabled="true"
                      title={`${route.label} — not built yet`}
                      className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground opacity-40"
                    >
                      <Icon className="size-4 shrink-0" />
                      {!collapsed && <span className="truncate">{route.label}</span>}
                    </div>
                  );
                }
                return (
                  <Link
                    key={route.href}
                    href={route.href}
                    className={cn(
                      "group relative flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-200 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full hover:bg-accent hover:text-foreground",
                      isActive ? "bg-primary/10 font-medium text-foreground before:bg-primary" : "text-muted-foreground before:bg-transparent",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {!collapsed && <span className="truncate">{route.label}</span>}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="flex min-h-11 cursor-pointer items-center justify-center gap-2 border-t border-border p-2 text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground"
      >
        {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
      </button>
    </aside>
  );
}
