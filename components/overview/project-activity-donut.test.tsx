import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { OverviewStats, ProjectSummary } from "@/types/oc";
import { ProjectActivityDonut, projectActivitySlices } from "./project-activity-donut";

function project(id: string, sessionCount: number, displayName = id): ProjectSummary {
  return {
    id, displayName, worktree: id === "global" ? "/" : `/work/${id}`, sessionCount, messageCount: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cost: { amount: 0, priced: false },
    firstActivity: null, lastActivity: null,
  };
}

function stats(projects: ProjectSummary[]): OverviewStats {
  return {
    totalSessions: 0, totalMessages: 0, totalTokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    totalCost: { amount: 0, priced: false }, storedCostComparison: 0, activeDays: 0, avgSessionLengthMs: null,
    sessionsThisWeek: 0, sessionsThisMonth: 0, unknownAgentCount: 0, unknownModelCount: 0,
    modelBreakdown: [], projectBreakdown: projects, dailyActivity: [], dailyTokens: [], hourOfDay: [],
    costBreakdown: { totalCost: { amount: 0, priced: false }, storedCostComparison: 0, byModel: [], byProject: [], byDay: [], bySession: [], byAgent: [] },
  };
}

describe("OCL-033 project activity", () => {
  it("forces the synthetic project label to global and collapses beyond the top eight", () => {
    const projects = [project("global", 30, "/"), ...Array.from({ length: 10 }, (_, index) => project(`project-${index}`, 20 - index))];
    const slices = projectActivitySlices(stats(projects));

    expect(slices.find((slice) => slice.key === "global")?.label).toBe("global");
    expect(slices.filter((slice) => slice.key !== "other")).toHaveLength(8);
    expect(slices.find((slice) => slice.key === "other")?.members).toEqual(["project-7", "project-8", "project-9"]);
  });

  it("renders the global label, other membership, and empty state", () => {
    const projects = [project("global", 30, "/"), ...Array.from({ length: 9 }, (_, index) => project(`project-${index}`, 20 - index))];
    const populated = renderToStaticMarkup(<ProjectActivityDonut stats={stats(projects)} />);
    const empty = renderToStaticMarkup(<ProjectActivityDonut stats={stats([])} />);

    expect(populated).toContain("global");
    expect(populated).toContain("Contains: project-7, project-8");
    expect(empty).toContain("No project activity data");
  });
});
