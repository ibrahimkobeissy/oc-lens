import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ModelUsage, OverviewStats } from "@/types/oc";
import { ModelBreakdownDonut, modelBreakdownSlices } from "./model-breakdown-donut";

function model(providerID: string, modelID: string, sessionCount: number): ModelUsage {
  return {
    providerID,
    modelID,
    sessionCount,
    messageCount: sessionCount,
    tokens: { input: sessionCount, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: { amount: 0, priced: false },
  };
}

function stats(models: ModelUsage[], unknownModelCount = 0): OverviewStats {
  return {
    totalSessions: 0, totalMessages: 0, totalTokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    totalCost: { amount: 0, priced: false }, storedCostComparison: 0, activeDays: 0, avgSessionLengthMs: null,
    sessionsThisWeek: 0, sessionsThisMonth: 0, unknownAgentCount: 0, unknownModelCount,
    modelBreakdown: models, projectBreakdown: [], dailyActivity: [], dailyTokens: [], hourOfDay: [],
    costBreakdown: { totalCost: { amount: 0, priced: false }, storedCostComparison: 0, byModel: [], byProject: [], byDay: [], bySession: [], byAgent: [] },
  };
}

describe("OCL-033 model breakdown", () => {
  it("keeps eight named slices including unknown, collapses the rest, and never hides unknown", () => {
    const models = Array.from({ length: 10 }, (_, index) => model("provider", `model-${index}`, 20 - index));
    models.push(model("unknown", "unknown", 99));
    const slices = modelBreakdownSlices(stats(models, 3));

    expect(slices.filter((slice) => slice.key.startsWith("provider/"))).toHaveLength(7);
    expect(slices.find((slice) => slice.key === "other")?.members).toEqual(["provider/model-7", "provider/model-8", "provider/model-9"]);
    expect(slices.find((slice) => slice.key === "unknown")?.value).toBe(3);
  });

  it("renders palette-backed legend data, accessible other members, and an honest empty state", () => {
    const models = Array.from({ length: 10 }, (_, index) => model("provider", `model-${index}`, 20 - index));
    const populated = renderToStaticMarkup(<ModelBreakdownDonut stats={stats(models, 2)} />);
    const empty = renderToStaticMarkup(<ModelBreakdownDonut stats={stats([])} />);

    expect(populated).toContain("var(--chart-1)");
    expect(populated).toContain("Contains: provider/model-7, provider/model-8, provider/model-9");
    expect(populated).toContain("unknown");
    expect(empty).toContain("No model breakdown data");
  });
});
