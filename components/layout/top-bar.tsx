"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Search, Sun } from "lucide-react";
import { matchRouteTrail } from "@/lib/routes";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";

/** Derived from the pathname + route registry — no per-page breadcrumb code (OCL-020's acceptance criterion). */
function Breadcrumbs() {
  const pathname = usePathname();
  const trail = matchRouteTrail(pathname);

  if (trail.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
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
      className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-4"
    >
      <Breadcrumbs />
      <div className="flex items-center gap-2">
        <CommandPaletteAffordance />
        <ThemeToggleButton />
      </div>
    </header>
  );
}
