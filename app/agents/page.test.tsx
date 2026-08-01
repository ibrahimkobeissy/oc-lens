import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-oc", () => ({
  useOc: () => ({
    data: {
      data: {
        agents: [{
          agent: "unknown",
          sessionCount: 1,
          messageCount: 2,
          tokens: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          cost: { amount: 0, priced: false },
          toolMix: [{ tool: "read", calls: 1 }],
          errorCount: 0,
          avgSessionLengthMs: 1_000,
        }],
        activity: [{ date: "2026-08-01", agent: "unknown", messageCount: 2 }],
        switches: [{ seq: 1, sessionId: "session-one", agent: "review", timeCreated: Date.UTC(2026, 7, 1) }],
      },
      meta: { generatedAt: 1, schemaVersion: "opencode-1.17.7", warnings: [] },
    },
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

import AgentsPage from "./page";

describe("OCL-101 AgentsPage", () => {
  it("integrates the breakdown, UTC activity, and recorded switch timeline", () => {
    const html = renderToStaticMarkup(<AgentsPage />);

    expect(html).toContain("Agents");
    expect(html).toContain("unknown");
    expect(html).toContain("not priced");
    expect(html).toContain("Agent messages over time");
    expect(html).toContain("Agent-switch timeline");
    expect(html).toContain("review");
    expect(html).toContain('href="/sessions/session-one"');
  });
});
