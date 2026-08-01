import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CacheEfficiency, cacheTotals } from "./cache-efficiency";
import { chartData } from "./cost-charts";
import { CostModelTable, sortedCostModels } from "./cost-model-table";
import { CostSummary } from "./cost-summary";
import { PricingBanner } from "./pricing-banner";
import type { CostBreakdown } from "@/types/oc";

function costs(priced = true, cache = true): CostBreakdown {
  return {
    totalCost: priced ? { amount: 12.34, priced: true } : { amount: 0, priced: false },
    storedCostComparison: 0,
    byModel: [
      { providerID: "provider", modelID: "unpriced", tokens: { input: 2_000, output: 100, reasoning: 50, cacheRead: 0, cacheWrite: 0 }, cost: { amount: 0, priced: false } },
      { providerID: "provider", modelID: "priced", tokens: { input: 1_000, output: 500, reasoning: 100, cacheRead: cache ? 300 : 0, cacheWrite: cache ? 100 : 0 }, cost: priced ? { amount: 12.34, priced: true } : { amount: 0, priced: false } },
    ],
    byProject: [{ projectId: "project-unpriced", cost: { amount: 0, priced: false } }, { projectId: "project-priced", cost: priced ? { amount: 12.34, priced: true } : { amount: 0, priced: false } }],
    byDay: [{ date: "2026-08-01", cost: { amount: 0, priced: false } }, { date: "2026-08-02", cost: priced ? { amount: 12.34, priced: true } : { amount: 0, priced: false } }],
    bySession: [],
    byAgent: [{ agent: "unknown", cost: { amount: 0, priced: false } }, { agent: "build", cost: priced ? { amount: 12.34, priced: true } : { amount: 0, priced: false } }],
  };
}

describe("OCL-092 cost components", () => {
  it("keeps unpriced models first and visible with every token class", () => {
    const value = costs();
    expect(sortedCostModels(value.byModel).map((model) => model.modelID)).toEqual(["unpriced", "priced"]);
    const html = renderToStaticMarkup(<CostModelTable models={value.byModel} />);
    expect(html).toContain("provider / unpriced");
    expect(html).toContain("not priced");
    for (const heading of ["Input", "Output", "Reasoning", "Cache read", "Cache write", "Total tokens", "Estimated cost"]) expect(html).toContain(heading);
  });

  it("shows a prominent pricing CTA and no fabricated $0.00 when every model is unpriced", () => {
    const value = costs(false, false);
    const html = renderToStaticMarkup(<><PricingBanner unpricedCount={2} /><CostSummary costs={value} /><CostModelTable models={value.byModel} /></>);
    expect(html).toContain('href="/settings/pricing"');
    expect(html).toContain("2 observed models are not priced");
    expect(html).toContain("not priced");
    expect(html).toContain("not reported");
    expect(html).not.toContain("$0.00");
  });

  it("reconciles the configured total exactly and labels provider comparison separately", () => {
    const html = renderToStaticMarkup(<CostSummary costs={costs()} />);
    expect(html).toContain("$12.34");
    expect(html).toContain("Provider-reported comparison");
    expect(html).toContain("Stored separately");
  });

  it("shows cache efficiency only when token evidence supports it", () => {
    const withCache = costs(true, true).byModel;
    expect(cacheTotals(withCache)).toMatchObject({ read: 300, write: 100 });
    const supported = renderToStaticMarkup(<CacheEfficiency models={withCache} />);
    expect(supported).toContain("Cache efficiency");
    expect(supported).toContain("Read 300 · Write 100");
    const unsupported = renderToStaticMarkup(<CacheEfficiency models={costs(true, false).byModel} />);
    expect(unsupported).toContain("Your provider does not report cache usage for this range.");
    expect(unsupported).not.toContain("Cache efficiency");
  });

  it("charts only configured cost buckets instead of graphing unpriced zeros", () => {
    const data = chartData(costs());
    expect(data.byDay).toEqual([{ date: "2026-08-02", cost: 12.34 }]);
    expect(data.byProject).toEqual([{ project: "project-priced", cost: 12.34 }]);
    expect(data.byAgent).toEqual([{ agent: "build", cost: 12.34 }]);
    expect(chartData(costs(false)).byDay).toEqual([]);
  });
});
