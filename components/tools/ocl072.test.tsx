import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mockUseOc = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-oc", () => ({ useOc: mockUseOc }));

import ToolsPage from "@/app/tools/page";
import { categoryRollups, rankedTools } from "@/components/tools/tool-ranking-chart";
import { ToolDurationTable } from "@/components/tools/tool-duration-table";
import type { ToolSummary } from "@/types/oc";

function tool(name: string, category: ToolSummary["category"], calls: number, p50: number | null = null, p95: number | null = null): ToolSummary {
  return { tool: name, category, totalCalls: calls, completedCount: calls, errorCount: 0, pendingCount: 0, runningCount: 0, p50DurationMs: p50, p95DurationMs: p95, firstSeen: 1, lastSeen: 2 };
}

const TOOLS = [tool("read", "file", 7, 10, 25), tool("bash", "exec", 3), tool("grep", "search", 5)] satisfies ToolSummary[];

describe("OCL-072 tools presentation", () => {
  it("keeps exact hand-computed totals while ranking and rolling up categories", () => {
    expect(rankedTools(TOOLS).map((item) => [item.tool, item.totalCalls])).toEqual([["read", 7], ["grep", 5], ["bash", 3]]);
    expect(rankedTools(TOOLS).reduce((sum, item) => sum + item.totalCalls, 0)).toBe(15);
    expect(categoryRollups(TOOLS).filter((item) => item.calls > 0)).toEqual([
      { category: "file", calls: 7 }, { category: "search", calls: 5 }, { category: "exec", calls: 3 },
    ]);
  });

  it("renders an em dash when timing evidence is absent", () => {
    const html = renderToStaticMarkup(<ToolDurationTable tools={TOOLS} />);
    expect(html).toContain("10ms");
    expect(html).toContain("25ms");
    expect(html).toContain("—");
  });

  it("does not hide non-tool adoption and version evidence when the tool-call list is empty", () => {
    const zero = { sessionCount: 0, pct: 0, firstUsed: null };
    mockUseOc.mockImplementation((route: string) => route.startsWith("/api/skills")
      ? { data: { data: [], meta: { generatedAt: 0, schemaVersion: "test", warnings: [] } }, error: undefined, isLoading: false, mutate: vi.fn() }
      : {
        data: {
          data: {
            tools: [], errors: [], activity: [], mcpServers: [], skills: [],
            featureAdoption: { subagents: { sessionCount: 1, pct: 0.5, firstUsed: 1 }, mcp: zero, webfetch: zero, planMode: zero, reasoning: zero, todos: zero, skills: zero },
            versionHistory: [{ version: "1.17.7", sessionCount: 2, messageCount: 4, firstSeen: 1, lastSeen: 2 }],
          },
          meta: { generatedAt: 0, schemaVersion: "test", warnings: [] },
        },
        error: undefined,
        isLoading: false,
        mutate: vi.fn(),
      });

    const html = renderToStaticMarkup(<ToolsPage />);
    expect(html).toContain("No tool calls in this range");
    expect(html).toContain("Feature adoption");
    expect(html).toContain("Version history");
    expect(html).toContain("1.17.7");
  });
});
