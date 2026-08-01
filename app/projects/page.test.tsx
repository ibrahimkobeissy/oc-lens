import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectCard } from "@/components/projects/project-card";
import type { ProjectSummary } from "@/types/oc";
import { filterAndSortProjects } from "./page";

function project(overrides: Partial<ProjectSummary> & Pick<ProjectSummary, "id" | "displayName">): ProjectSummary {
  return {
    id: overrides.id,
    displayName: overrides.displayName,
    worktree: overrides.worktree ?? `/work/${overrides.id}`,
    sessionCount: overrides.sessionCount ?? 0,
    messageCount: overrides.messageCount ?? 0,
    tokens: overrides.tokens ?? { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: overrides.cost ?? { amount: 0, priced: false },
    firstActivity: overrides.firstActivity ?? null,
    lastActivity: overrides.lastActivity ?? null,
  };
}

const PROJECTS = [
  project({ id: "global", displayName: "global", worktree: "/", sessionCount: 4, lastActivity: 100 }),
  project({ id: "alpha", displayName: "Alpha", worktree: "/very/long/worktrees/alpha", sessionCount: 2, messageCount: 20, tokens: { input: 1_000, output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cost: { amount: 5, priced: true }, lastActivity: null }),
  project({ id: "beta", displayName: "Beta", worktree: "/work/beta", sessionCount: 8, messageCount: 10, tokens: { input: 10, output: 10, reasoning: 10, cacheRead: 10, cacheWrite: 10 }, cost: { amount: 2, priced: true }, lastActivity: 200 }),
] satisfies ProjectSummary[];

describe("OCL-061 project filtering and sorting", () => {
  it("searches display name, id, and full worktree without mutating the source", () => {
    const original = PROJECTS.map((item) => item.id);
    expect(filterAndSortProjects(PROJECTS, "ALPHA", "name").map((item) => item.id)).toEqual(["alpha"]);
    expect(filterAndSortProjects(PROJECTS, "work/beta", "name").map((item) => item.id)).toEqual(["beta"]);
    expect(filterAndSortProjects(PROJECTS, "GLOBAL", "name").map((item) => item.id)).toEqual(["global"]);
    expect(PROJECTS.map((item) => item.id)).toEqual(original);
  });

  it("sorts every metric deterministically and keeps unknown values last", () => {
    expect(filterAndSortProjects(PROJECTS, "", "name").map((item) => item.id)).toEqual(["alpha", "beta", "global"]);
    expect(filterAndSortProjects(PROJECTS, "", "sessions").map((item) => item.id)).toEqual(["beta", "global", "alpha"]);
    expect(filterAndSortProjects(PROJECTS, "", "messages").map((item) => item.id)).toEqual(["alpha", "beta", "global"]);
    expect(filterAndSortProjects(PROJECTS, "", "tokens").map((item) => item.id)).toEqual(["alpha", "beta", "global"]);
    expect(filterAndSortProjects(PROJECTS, "", "last-active").map((item) => item.id)).toEqual(["beta", "global", "alpha"]);
    expect(filterAndSortProjects(PROJECTS, "", "cost").map((item) => item.id)).toEqual(["alpha", "beta", "global"]);
  });
});

describe("OCL-061 ProjectCard", () => {
  it("renders the global label, complete metrics, honest cost, and full-path tooltip evidence", () => {
    const item = project({
      id: "global",
      displayName: "global",
      worktree: "/a/very/long/path/to/the/global/worktree",
      sessionCount: 12,
      messageCount: 345,
      tokens: { input: 1_000, output: 200, reasoning: 30, cacheRead: 40, cacheWrite: 5 },
      cost: { amount: 0, priced: false },
      lastActivity: null,
    });

    const markup = renderToStaticMarkup(<ProjectCard project={item} />);

    expect(markup).toContain('href="/projects/global"');
    expect(markup).toContain(">global</span>");
    expect(markup).toContain("12");
    expect(markup).toContain("345");
    expect(markup).toContain("1.3K");
    expect(markup).toContain("not priced");
    expect(markup).toContain("No activity");
    expect(markup).toContain("Worktree: /a/very/long/path/to/the/global/worktree");
    expect(markup).toContain("direction:rtl");
  });
});
