import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ModelUsage, OverviewStats } from "@/types/oc";
import { TokenBreakdownPanel, modelTokenRows } from "./token-breakdown-panel";

function model(providerID: string, modelID: string, tokens: ModelUsage["tokens"]): ModelUsage {
  return { providerID, modelID, sessionCount: 1, messageCount: 1, tokens, cost: { amount: 0, priced: false } };
}

function stats(models: ModelUsage[]): OverviewStats {
  return {
    totalSessions: 0, totalMessages: 0, totalTokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    totalCost: { amount: 0, priced: false }, storedCostComparison: 0, activeDays: 0, avgSessionLengthMs: null,
    sessionsThisWeek: 0, sessionsThisMonth: 0, unknownAgentCount: 0, unknownModelCount: 0,
    modelBreakdown: models, projectBreakdown: [], dailyActivity: [], dailyTokens: [], hourOfDay: [],
    costBreakdown: { totalCost: { amount: 0, priced: false }, storedCostComparison: 0, byModel: [], byProject: [], byDay: [], bySession: [], byAgent: [] },
  };
}

describe("OCL-033 token breakdown panel", () => {
  it("aggregates duplicate and unknown models across all five token categories", () => {
    const rows = modelTokenRows(stats([
      model("provider", "model", { input: 10, output: 20, reasoning: 30, cacheRead: 40, cacheWrite: 50 }),
      model("provider", "model", { input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5 }),
      model("unknown", "unknown", { input: 2, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }),
    ]));

    expect(rows[0]).toEqual({
      key: "provider/model", label: "provider/model",
      tokens: { input: 11, output: 22, reasoning: 33, cacheRead: 44, cacheWrite: 55 }, total: 165,
    });
    expect(rows[1]?.label).toBe("unknown");
  });

  it("renders every category with stable palette colors and a clean empty state", () => {
    const populated = renderToStaticMarkup(<TokenBreakdownPanel stats={stats([
      model("provider", "model", { input: 10, output: 20, reasoning: 30, cacheRead: 40, cacheWrite: 50 }),
    ])} />);
    const empty = renderToStaticMarkup(<TokenBreakdownPanel stats={stats([])} />);

    for (const label of ["Input", "Output", "Reasoning", "Cache read", "Cache write"]) expect(populated).toContain(label);
    for (const color of [1, 2, 3, 4, 5]) expect(populated).toContain(`var(--chart-${color})`);
    expect(empty).toContain("No token data");
  });
});
