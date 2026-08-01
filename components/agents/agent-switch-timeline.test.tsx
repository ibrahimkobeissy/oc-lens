import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentSwitchTimeline } from "./agent-switch-timeline";

describe("OCL-101 AgentSwitchTimeline", () => {
  it("renders only the supplied recorded switch evidence", () => {
    const html = renderToStaticMarkup(<AgentSwitchTimeline events={[
      { seq: 7, sessionId: "session/one", agent: "review", timeCreated: Date.UTC(2026, 7, 1, 12) },
      { seq: 8, sessionId: null, agent: "unknown", timeCreated: Number.POSITIVE_INFINITY },
    ]} />);

    expect(html).toContain("#7");
    expect(html).toContain("review");
    expect(html).toContain('href="/sessions/session%2Fone"');
    expect(html).toContain("unknown");
    expect(html).toContain("Time unavailable");
    expect(html).toContain("Session unavailable");
    expect(html).not.toContain("build");
  });

  it("renders an honest empty state", () => {
    const html = renderToStaticMarkup(<AgentSwitchTimeline events={[]} />);
    expect(html).toContain("No agent switches recorded");
  });
});
