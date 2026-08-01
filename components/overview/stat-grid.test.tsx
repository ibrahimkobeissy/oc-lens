import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatGrid } from "@/components/overview/stat-grid";
import type { OverviewStats } from "@/types/oc";

function overview(priced = false): OverviewStats {
  const totalCost = { amount: priced ? 12.34 : 0, priced };
  return {
    totalSessions: 12,
    totalMessages: 34,
    totalTokens: { input: 1_000, output: 500, reasoning: 100, cacheRead: 250, cacheWrite: 50 },
    totalCost,
    storedCostComparison: 0,
    activeDays: 5,
    avgSessionLengthMs: 125_000,
    sessionsThisWeek: 3,
    sessionsThisMonth: 8,
    unknownAgentCount: 0,
    unknownModelCount: 0,
    modelBreakdown: [],
    projectBreakdown: [],
    dailyActivity: [],
    dailyTokens: [],
    hourOfDay: [],
    costBreakdown: {
      totalCost,
      storedCostComparison: 0,
      byModel: [],
      byProject: [],
      byDay: [],
      bySession: [],
      byAgent: [],
    },
  };
}

describe("OCL-031 StatGrid", () => {
  it("renders all eight cards and their exact supplied values", () => {
    const html = renderToStaticMarkup(<StatGrid stats={overview()} storageBytes={1_048_576} />);

    for (const label of ["Sessions", "Messages", "Tokens", "Estimated cost", "Active days", "Average session", "Sessions this week", "Storage"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain(">12<");
    expect(html).toContain(">34<");
    expect(html).toContain("1.9K");
    expect(html).toContain("Input 1K · Output 500 · Cache 300");
    expect(html).toContain("2m 5s");
    expect(html).toContain("8 this month");
    expect(html).toContain("1.0 MB");
  });

  it("renders honest unpriced and priced cost states", () => {
    const unpriced = renderToStaticMarkup(<StatGrid stats={overview()} storageBytes={0} />);
    const priced = renderToStaticMarkup(<StatGrid stats={overview(true)} storageBytes={0} />);

    expect(unpriced).toContain("not priced");
    expect(unpriced).toContain('href="/settings/pricing"');
    expect(priced).toContain("$12.34");
    expect(priced).not.toContain("not priced");
  });
});
