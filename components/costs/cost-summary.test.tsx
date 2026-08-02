import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CostSummary, providerCost } from "./cost-summary";
import type { CostBreakdown } from "@/types/oc";

describe("providerCost (code-review-2026-08-02.md L4)", () => {
  it("renders a positive amount as USD currency", () => {
    expect(providerCost(4)).toBe("$4.00");
    expect(providerCost(12.3)).toBe("$12.30");
  });

  it("renders 'not reported' for zero, negative, or non-finite input instead of -$x or $NaN", () => {
    expect(providerCost(0)).toBe("not reported");
    expect(providerCost(-5)).toBe("not reported");
    expect(providerCost(Number.NaN)).toBe("not reported");
    expect(providerCost(Number.POSITIVE_INFINITY)).toBe("not reported");
  });
});

function costs(overrides: Partial<CostBreakdown> = {}): CostBreakdown {
  return {
    totalCost: { amount: 0, priced: false },
    storedCostComparison: 0,
    byModel: [],
    byProject: [],
    byDay: [],
    bySession: [],
    byAgent: [],
    ...overrides,
  };
}

describe("CostSummary", () => {
  it("never renders a negative provider-reported comparison", () => {
    const html = renderToStaticMarkup(<CostSummary costs={costs({ storedCostComparison: -3 })} />);
    expect(html).toContain("not reported");
    expect(html).not.toContain("-$3");
  });
});
