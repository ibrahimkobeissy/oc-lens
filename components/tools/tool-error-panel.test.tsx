import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { errorCategoryRows } from "@/components/tools/error-category-chart";
import { ToolErrorPanel, toolErrorRate } from "@/components/tools/tool-error-panel";
import type { ToolErrorSummary, ToolSummary } from "@/types/oc";

const tools = [{ tool: "bash", category: "exec", totalCalls: 10, completedCount: 8, errorCount: 2, pendingCount: 0, runningCount: 0, p50DurationMs: 1, p95DurationMs: 2, firstSeen: 1, lastSeen: 2 }] satisfies ToolSummary[];
const errors = [{ partId: "part/a", sessionId: "session/a", tool: "bash", message: "unclassified raw failure", category: "other", timeCreated: Date.UTC(2026, 0, 2) }] satisfies ToolErrorSummary[];

describe("OCL-074 tool errors", () => {
  it("computes error rate against calls rather than sessions", () => {
    expect(toolErrorRate(tools)).toEqual({ errors: 2, calls: 10, pct: 20 });
  });

  it("keeps other errors and their raw message visible with an exact-part link", () => {
    expect(errorCategoryRows(errors)).toEqual([{ category: "other", errors: 1 }]);
    const html = renderToStaticMarkup(<ToolErrorPanel tools={tools} errors={errors} activity={[{ date: "2026-01-02", totalCalls: 10, errorCount: 2 }]} />);
    expect(html).toContain("20.0%");
    expect(html).toContain("unclassified raw failure");
    expect(html).toContain("/sessions/session%2Fa?part=part%2Fa");
  });
});
