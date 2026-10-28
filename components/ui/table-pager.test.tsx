import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { sortToolDurations } from "@/components/tools/tool-duration-table";
import type { ToolSummary } from "@/types/oc";
import { pageCount, TablePager } from "./table-pager";

function tool(name: string, calls: number, p50: number | null): ToolSummary { return { tool: name, category: "file", totalCalls: calls, completedCount: calls, errorCount: 0, pendingCount: 0, runningCount: 0, p50DurationMs: p50, p95DurationMs: p50, firstSeen: 1, lastSeen: 1 }; }

describe("TablePager", () => {
  it("counts pages and never reports zero pages", () => {
    expect(pageCount(0, 10)).toBe(1);
    expect(pageCount(115, 25)).toBe(5);
    expect(pageCount(10, 10)).toBe(1);
  });

  it("shows the count, page X of Y, and a rows-per-page choice", () => {
    const html = renderToStaticMarkup(<TablePager total={115} noun={["session", "sessions"]} page={2} pageSize={25} onPageSize={() => undefined} canPrevious canNext onPrevious={() => undefined} onNext={() => undefined} />);
    expect(html).toContain("115 sessions · Page 2 of 5");
    expect(html).toContain("Rows per page");
    expect(html).toMatch(/<option value="25" selected="">25<\/option>/);
  });
});

describe("tool duration sorting", () => {
  const tools = [tool("read", 50, 10), tool("edit", 90, null), tool("bash", 20, 400)];

  it("defaults to calls descending and sorts any column either way", () => {
    expect(sortToolDurations(tools, "calls", "desc").map((t) => t.tool)).toEqual(["edit", "read", "bash"]);
    expect(sortToolDurations(tools, "tool", "asc").map((t) => t.tool)).toEqual(["bash", "edit", "read"]);
  });

  it("keeps a tool without timing last in both directions", () => {
    expect(sortToolDurations(tools, "p50", "desc").map((t) => t.tool)).toEqual(["bash", "read", "edit"]);
    expect(sortToolDurations(tools, "p50", "asc").map((t) => t.tool)).toEqual(["read", "bash", "edit"]);
  });
});
