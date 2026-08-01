import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { providerReportedTurnCost, TurnMetrics, turnCostsDisagree } from "./turn-metrics";
import type { OcPartStepFinishData, ReplayPart, ReplayTurn } from "@/types/oc";

function stepFinish(id: string, cost: number | null): ReplayPart {
  const data: OcPartStepFinishData = { type: "step-finish", reason: "stop", cost, tokens: null };
  return { id, data };
}

function turn(overrides: Partial<ReplayTurn> = {}): ReplayTurn {
  return {
    messageId: "message",
    role: "assistant",
    agent: "build",
    timeCreated: 100,
    timeCompleted: 1_350,
    durationMs: 1_250,
    tokens: { input: 100, output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: { amount: 0, priced: false },
    parts: [],
    ...overrides,
  };
}

describe("OCL-057 TurnMetrics", () => {
  it("renders missing duration and unpriced cost honestly", () => {
    const html = renderToStaticMarkup(<TurnMetrics turn={turn({ timeCompleted: null, durationMs: null })} />);

    expect(html).toContain("Duration");
    expect(html).toContain("—");
    expect(html).toContain("Your configured cost");
    expect(html).toContain("not priced");
    expect(html).toContain("Provider-reported cost");
    expect(html).toContain("not reported");
    expect(html).not.toMatch(/NaN|Infinity|\$0\.00/);
  });

  it("shows provider zero beside a non-zero user-priced cost and labels disagreement", () => {
    const value = turn({ cost: { amount: 2.5, priced: true }, parts: [stepFinish("finish", 0)] });
    const html = renderToStaticMarkup(<TurnMetrics turn={value} />);

    expect(html).toContain("Your configured cost");
    expect(html).toContain("$2.50");
    expect(html).toContain("Provider-reported cost");
    expect(html).toContain("$0.00");
    expect(html).toContain("Different");
    expect(turnCostsDisagree(value)).toBe(true);
  });

  it("sums valid step-finish costs and ignores absent or invalid signals", () => {
    const value = turn({
      cost: { amount: 0.75, priced: true },
      parts: [
        stepFinish("first", 0.25),
        stepFinish("missing", null),
        stepFinish("invalid", Number.POSITIVE_INFINITY),
        stepFinish("second", 0.5),
      ],
    });

    expect(providerReportedTurnCost(value)).toBe(0.75);
    expect(turnCostsDisagree(value)).toBe(false);
    expect(renderToStaticMarkup(<TurnMetrics turn={value} />)).not.toContain("Different");
  });
});
