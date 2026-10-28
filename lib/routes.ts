import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bot,
  DollarSign,
  Download,
  FolderKanban,
  LayoutDashboard,
  Repeat,
  MessagesSquare,
  Settings,
  ShieldAlert,
  Wrench,
} from "lucide-react";

/**
 * The single extension point for navigation. A new page adds its entry here
 * and nowhere else — never in the sidebar/top-bar/mobile-nav components that
 * render this array.
 *
 * `enabled: false` means the page doesn't exist yet — it renders in the nav
 * as present-but-inert (visually muted, not a real link) rather than being
 * hidden, so the full v1 surface area is visible from day one.
 */
export interface OcRoute {
  href: string;
  label: string;
  icon: LucideIcon;
  group: string;
  enabled: boolean;
}

export const ROUTE_GROUPS = [
  "overview",
  "activity",
  "sessions",
  "projects",
  "tools",
  "costs",
  "audit",
  "loops",
  "agents",
  "export",
  "settings",
] as const;

export const ROUTES: OcRoute[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard, group: "overview", enabled: true },
  { href: "/activity", label: "Activity", icon: Activity, group: "activity", enabled: true },
  { href: "/sessions", label: "Sessions", icon: MessagesSquare, group: "sessions", enabled: true },
  { href: "/projects", label: "Projects", icon: FolderKanban, group: "projects", enabled: true },
  { href: "/tools", label: "Tools", icon: Wrench, group: "tools", enabled: true },
  { href: "/costs", label: "Costs", icon: DollarSign, group: "costs", enabled: true },
  { href: "/audit", label: "Provider audit", icon: ShieldAlert, group: "audit", enabled: true },
  { href: "/loops", label: "Loops", icon: Repeat, group: "loops", enabled: true },
  { href: "/agents", label: "Agents", icon: Bot, group: "agents", enabled: true },
  { href: "/export", label: "Export", icon: Download, group: "export", enabled: true },
  { href: "/settings", label: "Settings", icon: Settings, group: "settings", enabled: true },
  { href: "/settings/pricing", label: "Pricing", icon: DollarSign, group: "settings", enabled: true },
];

/** Routes usable as primary mobile bottom-nav entries — one per user-facing group, dev tooling excluded. */
export const MOBILE_NAV_ROUTES: OcRoute[] = [
  ROUTES[0], // Overview
  ROUTES[2], // Sessions
  ROUTES[3], // Projects
  ROUTES[5], // Costs
  ROUTES[9], // Export
].filter((r): r is OcRoute => r !== undefined);

/**
 * Longest-registered-prefix match against a pathname, for breadcrumbs and
 * active-link highlighting. Returns the routes (most specific last) whose
 * `href` is a prefix of `pathname`, so `/settings/pricing` yields both
 * `/settings` and `/settings/pricing`.
 */
export function matchRouteTrail(pathname: string): OcRoute[] {
  return ROUTES.filter((route) => route.href === "/" ? pathname === "/" : pathname.startsWith(route.href)).sort(
    (a, b) => a.href.length - b.href.length,
  );
}
