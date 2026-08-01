import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentActivityChart, agentActivityChartData } from "./agent-activity-chart";

describe("OCL-101 AgentActivityChart", () => {
  it("pivots UTC activity deterministically and fills absent agent days with zero", () => {
    expect(agentActivityChartData([
      { date: "2026-08-02", agent: "unknown", messageCount: 1 },
      { date: "2026-08-01", agent: "build", messageCount: 2 },
      { date: "2026-08-01", agent: "build", messageCount: 3 },
    ])).toEqual({
      data: [
        { date: "2026-08-01", build: 5, unknown: 0 },
        { date: "2026-08-02", unknown: 1, build: 0 },
      ],
      series: [{ key: "build", label: "build" }, { key: "unknown", label: "unknown" }],
    });
  });

  it("renders an honest empty state", () => {
    const html = renderToStaticMarkup(<AgentActivityChart points={[]} />);
    expect(html).toContain("Agent messages over time");
    expect(html).toContain("No agent message activity is available.");
  });
});
