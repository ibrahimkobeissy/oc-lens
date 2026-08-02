"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MOBILE_NAV_ROUTES } from "@/lib/routes";

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      data-slot="mobile-nav"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface/95 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur md:hidden"
    >
      {MOBILE_NAV_ROUTES.map((route) => {
        const Icon = route.icon;
        const isActive = route.enabled && (route.href === "/" ? pathname === "/" : pathname.startsWith(route.href));
        if (!route.enabled) {
          return (
            <div
              key={route.href}
              aria-disabled="true"
              className="flex min-h-14 flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] text-muted-foreground opacity-40"
            >
              <Icon className="size-5" />
              {route.label}
            </div>
          );
        }
        return (
          <Link
            key={route.href}
            href={route.href}
            className={cn(
              "relative flex min-h-14 flex-1 cursor-pointer flex-col items-center justify-center gap-1 py-2 text-[10px] transition-colors duration-200",
              isActive ? "font-medium text-primary after:absolute after:inset-x-5 after:bottom-1 after:h-0.5 after:rounded-full after:bg-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-5" />
            {route.label}
          </Link>
        );
      })}
    </nav>
  );
}
