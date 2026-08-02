"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Moon, RefreshCw, Search, Sun } from "lucide-react";
import { mutate } from "swr";
import { matchRouteTrail } from "@/lib/routes";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Derived from the pathname + route registry — no per-page breadcrumb code (OCL-020's acceptance criterion). */
function Breadcrumbs() {
  const pathname = usePathname();
  const trail = matchRouteTrail(pathname);

  if (trail.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
      {trail.map((route, i) => {
        const isLast = i === trail.length - 1;
        return (
          <span key={route.href} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground/50">/</span>}
            {isLast || !route.enabled ? (
              <span className={isLast ? "font-medium text-foreground" : undefined}>{route.label}</span>
            ) : (
              <Link href={route.href} className="hover:text-foreground">
                {route.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function ThemeToggleButton() {
  const { theme, toggleTheme, mounted } = useTheme();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={toggleTheme}
      disabled={!mounted}
    >
      {mounted && theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

/** Revalidates every currently mounted `useOc` (SWR) key at once — a manual complement to the default 30s poll. */
function RefreshButton() {
  const [refreshing, setRefreshing] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label="Refresh data"
      disabled={refreshing}
      onClick={async () => {
        setRefreshing(true);
        try {
          await mutate(() => true, undefined, { revalidate: true });
        } finally {
          setRefreshing(false);
        }
      }}
    >
      <RefreshCw aria-hidden="true" className={cn("size-4", refreshing && "animate-spin")} />
    </Button>
  );
}

function CommandPaletteAffordance() {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-2 text-muted-foreground"
      onClick={() => window.dispatchEvent(new Event("oc-lens:open-search"))}
    >
      <Search className="size-3.5" />
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden rounded border border-border bg-muted px-1.5 font-mono text-[10px] sm:inline">⌘K</kbd>
    </Button>
  );
}

export function TopBar() {
  return (
    <header
      data-slot="top-bar"
      className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface/90 px-4 shadow-[0_1px_0_rgba(30,64,175,0.05)] backdrop-blur sm:px-6"
    >
      <Breadcrumbs />
      <div className="flex items-center gap-2">
        <div className="hidden items-center gap-2 rounded-full border border-warning/30 bg-warning/5 px-3 py-1.5 text-[11px] text-muted-foreground lg:flex" title="oc-lens never writes to the opencode database" aria-label="Read-only signal: oc-lens never writes to the opencode database">
          <span className="signal-dot size-1.5 rounded-full bg-warning" aria-hidden="true" />
          <Activity aria-hidden="true" className="size-3.5 text-primary" />
          <span className="font-mono uppercase tracking-[0.12em]">read-only signal</span>
        </div>
        <CommandPaletteAffordance />
        <RefreshButton />
        <ThemeToggleButton />
      </div>
    </header>
  );
}
