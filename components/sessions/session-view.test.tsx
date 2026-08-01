import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { apiRouteFromParams, filterValuesFromParams, nextPageParams, previousPageParams } from "@/app/sessions/page";
import { SessionBadges, sessionBadgeEvidence } from "./session-badges";
import { sessionTotalTokens } from "./session-table";
import type { SessionSummary } from "@/types/oc";

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "ses_child", slug: "crisp-otter", title: "Review exact evidence", projectId: "project", projectDisplayName: "Project",
    directory: "/tmp/project", agent: "build", model: { id: "model", providerID: "provider", variant: "default" }, version: "1.17.7",
    timeCreated: 100, timeUpdated: 200, durationMs: 100, timeArchived: 300, parentId: "ses_parent",
    messageCounts: { user: 2, assistant: 3 }, toolCallCount: 7, errorCount: 3,
    tokens: { input: 100, output: 20, reasoning: 5, cacheRead: 30, cacheWrite: 10 }, cost: { amount: 0, priced: false },
    hasReasoning: true, hasCompaction: true, usesMcp: true, usesSubagent: true, usesWebfetch: false,
    ...overrides,
  };
}

describe("OCL-051 session view contracts", () => {
  it("round-trips every filter/sort/cursor into the API while keeping pagination history UI-only", () => {
    const params = new URLSearchParams({ search: "otter", project: "project", agent: "build", model: "provider/model", from: "100", to: "200", archived: "false", hasError: "true", isSubagent: "false", sort: "tokens", order: "asc", limit: "25", cursor: "opaque" });
    params.append("trail", "~");
    const route = apiRouteFromParams(params);
    expect(route).toContain("search=otter");
    expect(route).toContain("hasError=true");
    expect(route).toContain("cursor=opaque");
    expect(route).not.toContain("trail");
  });

  it("preserves cursor history so copied page URLs have deterministic previous/next views", () => {
    const first = new URLSearchParams("project=project");
    const second = nextPageParams(first, "cursor-2");
    const third = nextPageParams(second, "cursor-3");
    expect(third.getAll("trail")).toEqual(["~", "cursor-2"]);
    expect(previousPageParams(third).get("cursor")).toBe("cursor-2");
    expect(previousPageParams(second).get("cursor")).toBeNull();
  });

  it("maps epoch URL boundaries back to inclusive date controls", () => {
    const from = new Date("2026-08-01T00:00:00").getTime();
    const to = new Date("2026-08-04T00:00:00").getTime();
    const values = filterValuesFromParams(new URLSearchParams({ from: `${from}`, to: `${to}` }));
    expect(values.from).toBe("2026-08-01");
    expect(values.to).toBe("2026-08-03");
  });

  it("names exact evidence for every visible badge, including failed tool count", () => {
    const evidence = sessionBadgeEvidence(session());
    expect(evidence.map((badge) => badge.key)).toEqual(["reasoning", "compaction", "mcp", "subagent", "errors", "archived"]);
    expect(evidence.find((badge) => badge.key === "errors")?.evidence).toBe("3 tool calls failed.");
    expect(evidence.every((badge) => badge.evidence.length > 10)).toBe(true);

    const markup = renderToStaticMarkup(<SessionBadges session={session()} />);
    expect(markup).toContain('<button type="button"');
    expect(markup).toContain('aria-label="Reasoning: At least one reasoning part was recorded."');
  });

  it("totals every reported token class and keeps the table horizontally scrollable at 360px", () => {
    expect(sessionTotalTokens(session())).toBe(165);
    const source = readFileSync("components/sessions/session-table.tsx", "utf8");
    expect(source).toContain("overflow-x-auto");
    expect(source).toContain("min-w-[1120px]");
  });
});
