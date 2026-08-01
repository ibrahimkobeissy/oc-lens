import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AgentSummary } from "@/types/oc";
import { AgentBreakdownTable, errorRate, toolCallCount } from "./agent-breakdown-table";

function agent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    agent: "build",
    sessionCount: 3,
    messageCount: 20,
    tokens: { input: 1_000, output: 200, reasoning: 30, cacheRead: 40, cacheWrite: 5 },
    cost: { amount: 0, priced: false },
    toolMix: [{ tool: "read", calls: 3 }, { tool: "bash", calls: 1 }],
    errorCount: 2,
    avgSessionLengthMs: 125_000,
    ...overrides,
  };
}

describe("OCL-101 AgentBreakdownTable", () => {
  it("computes tool-call error rate from supplied aggregate evidence", () => {
    const value = agent();
    expect(toolCallCount(value)).toBe(4);
    expect(errorRate(value)).toBe(0.5);
    expect(errorRate(agent({ toolMix: [], errorCount: 0 }))).toBeNull();
  });

  it("renders all metrics, explicit unknown, honest unpriced cost, and complete tool mix", () => {
    const html = renderToStaticMarkup(<AgentBreakdownTable agents={[agent({ agent: "unknown" })]} />);

    for (const heading of ["Agent", "Sessions", "Messages", "Tokens", "Cost", "Error rate", "Avg session", "Tool mix"]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain("unknown");
    expect(html).toContain("1.3K");
    expect(html).toContain("not priced");
    expect(html).toContain("50.0%");
    expect(html).toContain("2/4");
    expect(html).toContain("2m 5s");
    expect(html).toContain("read 3");
    expect(html).toContain("bash 1");
  });
});
