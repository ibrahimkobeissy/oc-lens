import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ProjectDetail as ProjectDetailData, SessionSummary } from "@/types/oc";
import { ProjectDetail, projectDailyTokens, projectModelSlices, projectSessions } from "./project-detail";

function session(overrides: Partial<SessionSummary> & Pick<SessionSummary, "id">): SessionSummary {
  return {
    id: overrides.id,
    slug: overrides.slug ?? overrides.id,
    title: overrides.title ?? `Session ${overrides.id}`,
    projectId: "project-one",
    projectDisplayName: "Project One",
    directory: "/work/project-one",
    agent: overrides.agent ?? "build",
    model: overrides.model === undefined ? { id: "gpt-test", providerID: "openai", variant: "default" } : overrides.model,
    version: "1.17.7",
    timeCreated: overrides.timeCreated ?? Date.UTC(2026, 7, 1, 10),
    timeUpdated: overrides.timeUpdated ?? Date.UTC(2026, 7, 1, 10, 2),
    durationMs: overrides.durationMs ?? 120_000,
    timeArchived: null,
    parentId: null,
    messageCounts: overrides.messageCounts ?? { user: 1, assistant: 1 },
    toolCallCount: 0,
    errorCount: 0,
    tokens: overrides.tokens ?? { input: 1_000, output: 200, reasoning: 30, cacheRead: 40, cacheWrite: 5 },
    cost: overrides.cost ?? { amount: 0, priced: false },
    hasReasoning: false,
    hasCompaction: false,
    usesMcp: false,
    usesSubagent: false,
    usesWebfetch: false,
  };
}

function project(sessions: SessionSummary[]): ProjectDetailData {
  return {
    id: "project-one",
    displayName: "Project One",
    worktree: "/a/very/long/worktree/project-one",
    sessionCount: sessions.length,
    messageCount: sessions.reduce((total, item) => total + item.messageCounts.user + item.messageCounts.assistant, 0),
    tokens: sessions.reduce((tokens, item) => ({
      input: tokens.input + item.tokens.input,
      output: tokens.output + item.tokens.output,
      reasoning: tokens.reasoning + item.tokens.reasoning,
      cacheRead: tokens.cacheRead + item.tokens.cacheRead,
      cacheWrite: tokens.cacheWrite + item.tokens.cacheWrite,
    }), { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }),
    cost: { amount: 0, priced: false },
    firstActivity: sessions.length > 0 ? Math.min(...sessions.map((item) => item.timeCreated)) : null,
    lastActivity: sessions.length > 0 ? Math.max(...sessions.map((item) => item.timeUpdated)) : null,
    sessions,
    dailyActivity: sessions.length > 0 ? [{ date: "2026-08-01", sessionCount: sessions.length, messageCount: sessions.length * 2, toolCallCount: 0 }] : [],
    modelBreakdown: sessions.length > 0 ? [
      { providerID: "openai", modelID: "message-model", sessionCount: 1, messageCount: 3, tokens: { input: 1, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cost: { amount: 0, priced: false } },
      { providerID: "unknown", modelID: "unknown", sessionCount: 1, messageCount: 1, tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cost: { amount: 0, priced: false } },
    ] : [],
    branches: ["main"],
  };
}

describe("OCL-062 project detail derivations", () => {
  it("groups session tokens by UTC day and sorts both activity and sessions", () => {
    const older = session({ id: "older", timeCreated: Date.UTC(2026, 7, 1), tokens: { input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5 } });
    const newer = session({ id: "newer", timeCreated: Date.UTC(2026, 7, 2), tokens: { input: 10, output: 20, reasoning: 30, cacheRead: 40, cacheWrite: 50 } });
    const sameDay = session({ id: "same-day", timeCreated: Date.UTC(2026, 7, 1, 12), tokens: { input: 5, output: 4, reasoning: 3, cacheRead: 2, cacheWrite: 1 } });

    expect(projectDailyTokens([newer, older, sameDay])).toEqual([
      { date: "2026-08-01", tokens: { input: 6, output: 6, reasoning: 6, cacheRead: 6, cacheWrite: 6 } },
      { date: "2026-08-02", tokens: { input: 10, output: 20, reasoning: 30, cacheRead: 40, cacheWrite: 50 } },
    ]);
    expect(projectDailyTokens([
      session({ id: "boundary", timeCreated: Date.UTC(2026, 7, 2, 1) }),
    ], "America/Los_Angeles")[0]?.date).toBe("2026-08-01");
    expect(projectSessions([older, newer, sameDay]).map((item) => item.id)).toEqual(["newer", "same-day", "older"]);
  });

  it("uses message-derived model counts and keeps missing identities in an explicit unknown slice", () => {
    expect(projectModelSlices([
      { providerID: "openai", modelID: "switched-model", sessionCount: 1, messageCount: 3, tokens: { input: 1, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cost: { amount: 0, priced: false } },
      { providerID: "unknown", modelID: "unknown", sessionCount: 1, messageCount: 1, tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cost: { amount: 0, priced: false } },
    ])).toEqual([
      { key: "openai/switched-model", label: "openai/switched-model", value: 3 },
      { key: "unknown", label: "unknown", value: 1 },
    ]);
  });
});

describe("OCL-062 ProjectDetail", () => {
  it("renders aggregates, reusable charts, breadcrumbs, and project-scoped replay links", () => {
    const data = project([
      session({ id: "session/one", title: "First session" }),
      session({ id: "session-two", title: "Unknown evidence", agent: null, model: null }),
    ]);
    const html = renderToStaticMarkup(<ProjectDetail project={data} timeZone="UTC" />);

    expect(html).toContain('href="/projects"');
    expect(html).toContain("Projects");
    expect(html).toContain("Project One");
    expect(html).toContain("Usage over time");
    expect(html).toContain("Model breakdown");
    expect(html).toContain("openai/message-model");
    expect(html).toContain("unknown");
    expect(html).toContain("not priced");
    expect(html).toContain("main");
    expect(html).toContain('href="/sessions/session%2Fone"');
    expect(html).toContain('href="/sessions/session-two"');
    expect(html).toContain("Every session returned for this project");
  });

  it("renders honest empty chart and session states", () => {
    const html = renderToStaticMarkup(<ProjectDetail project={{ ...project([]), branches: undefined }} timeZone="UTC" />);
    expect(html).toContain("No usage was recorded in this range.");
    expect(html).toContain("No message model data is available for this project.");
    expect(html).toContain("No sessions recorded");
    expect(html).toContain("Time unavailable");
    expect(html).not.toContain("Project branches");
  });
});
