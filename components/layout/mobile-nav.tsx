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
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface md:hidden"
    >
      {MOBILE_NAV_ROUTES.map((route) => {
        const Icon = route.icon;
        const isActive = route.enabled && (route.href === "/" ? pathname === "/" : pathname.startsWith(route.href));
        if (!route.enabled) {
          return (
            <div
              key={route.href}
              aria-disabled="true"
              className="flex flex-1 flex-col items-center gap-1 py-2 text-[10px] text-muted-foreground opacity-40"
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
              "flex flex-1 flex-col items-center gap-1 py-2 text-[10px]",
              isActive ? "text-foreground" : "text-muted-foreground",
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
