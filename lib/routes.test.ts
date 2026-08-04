import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MOBILE_NAV_ROUTES, ROUTES, matchRouteTrail } from "./routes";

/** `href` -> the App Router page file it must resolve to, e.g. "/agents/tree" -> "app/agents/tree/page.tsx". */
function pageFileFor(href: string): string {
  return href === "/" ? join(process.cwd(), "app", "page.tsx") : join(process.cwd(), "app", ...href.split("/").filter(Boolean), "page.tsx");
}

describe("ROUTES", () => {
  it("registers every v1 page ticket's route", () => {
    const hrefs = ROUTES.map((r) => r.href);
    expect(hrefs).toEqual([
      "/",
      "/activity",
      "/sessions",
      "/projects",
      "/tools",
      "/todos",
      "/costs",
      "/agents",
      "/agents/tree",
      "/export",
      "/settings",
      "/settings/pricing",
    ]);
  });

  it("marks only the pages that actually exist as enabled", () => {
    const enabled = ROUTES.filter((r) => r.enabled).map((r) => r.href);
    expect(enabled).toEqual([
      "/",
      "/activity",
      "/sessions",
      "/projects",
      "/tools",
      "/todos",
      "/costs",
      "/agents",
      "/agents/tree",
      "/export",
      "/settings",
      "/settings/pricing",
    ]);
  });

  it("has a real page.tsx behind every route marked enabled (code-review-2026-08-02.md L8)", () => {
    const missing = ROUTES.filter((r) => r.enabled).map((r) => r.href).filter((href) => !existsSync(pageFileFor(href)));
    expect(missing).toEqual([]);
  });
});

describe("MOBILE_NAV_ROUTES", () => {
  it("has no undefined entries and one route per curated group", () => {
    expect(MOBILE_NAV_ROUTES).toHaveLength(5);
    expect(MOBILE_NAV_ROUTES.every((r) => r !== undefined)).toBe(true);
  });
});

describe("matchRouteTrail", () => {
  it("matches the root route only for '/'", () => {
    expect(matchRouteTrail("/").map((r) => r.href)).toEqual(["/"]);
  });

  it("builds a trail from most general to most specific for nested routes", () => {
    expect(matchRouteTrail("/settings/pricing").map((r) => r.href)).toEqual(["/settings", "/settings/pricing"]);
  });

  it("does not match '/' as a prefix of every route", () => {
    expect(matchRouteTrail("/sessions").map((r) => r.href)).toEqual(["/sessions"]);
  });

  it("returns an empty trail for an unregistered path", () => {
    expect(matchRouteTrail("/nonexistent")).toEqual([]);
  });
});
