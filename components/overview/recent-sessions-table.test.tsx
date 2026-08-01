import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RecentSessionsTable, recentSessions } from "./recent-sessions-table";
import type { SessionSummary } from "@/types/oc";

function session(index: number, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: `ses_${index}`, slug: `slug-${index}`, title: `Session title ${index}`, projectId: "project", projectDisplayName: "Project",
    directory: "/tmp/project", agent: "build", model: { id: "model", providerID: "provider", variant: "default" }, version: "1.17.7",
    timeCreated: index * 1_000, timeUpdated: index * 1_000 + 500, durationMs: 500, timeArchived: null, parentId: null,
    messageCounts: { user: 2, assistant: 3 }, toolCallCount: 1, errorCount: 0,
    tokens: { input: 1_000, output: 200, reasoning: 50, cacheRead: 100, cacheWrite: 25 }, cost: { amount: 0, priced: false },
    hasReasoning: false, hasCompaction: false, usesMcp: false, usesSubagent: false, usesWebfetch: false,
    ...overrides,
  };
}

describe("OCL-034 RecentSessionsTable", () => {
  it("sorts deterministically and caps the supplied range at the latest ten sessions", () => {
    const supplied = Array.from({ length: 12 }, (_, index) => session(index)).reverse();
    const rows = recentSessions(supplied);
    expect(rows.map((row) => row.id)).toEqual(["ses_11", "ses_10", "ses_9", "ses_8", "ses_7", "ses_6", "ses_5", "ses_4", "ses_3", "ses_2"]);
  });

  it("renders every required column, detail links, full title tooltip, and honest unknown/unpriced values", () => {
    const fallbackTitle = "First user prompt used in place of the generated placeholder title and deliberately long enough to truncate";
    const html = renderToStaticMarkup(<RecentSessionsTable sessions={[session(1, { title: fallbackTitle, agent: null, model: null })]} />);
    for (const heading of ["Session", "Project", "Agent", "Model", "When", "Duration", "Messages", "Tokens", "Cost"]) expect(html).toContain(`>${heading}<`);
    expect(html).toContain('href="/sessions/ses_1"');
    expect(html).toContain(`title="${fallbackTitle}"`);
    expect(html).toContain("unknown");
    expect(html).toContain("not priced");
    expect(html).not.toContain("$0.00");
  });

  it("owns a horizontal scroll container and renders an explanatory empty state", () => {
    const populated = renderToStaticMarkup(<RecentSessionsTable sessions={[session(1)]} />);
    expect(populated).toContain("overflow-x-auto");
    expect(populated).toContain("min-w-[1040px]");
    const empty = renderToStaticMarkup(<RecentSessionsTable sessions={[]} />);
    expect(empty).toContain("No sessions in this range");
    expect(empty).toContain("Choose a wider range");
  });
});
