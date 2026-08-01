import { describe, expect, it } from "vitest";
import { MOBILE_NAV_ROUTES, ROUTES, matchRouteTrail } from "./routes";

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
      "/style-guide",
    ]);
  });

  it("marks only the pages that actually exist as enabled", () => {
    const enabled = ROUTES.filter((r) => r.enabled).map((r) => r.href);
    expect(enabled).toEqual(["/", "/style-guide"]);
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
