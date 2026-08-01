import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OcApiError } from "@/lib/swr";
import type { OverviewStats } from "@/types/oc";

const activityRetry = vi.fn();
const sessionsRetry = vi.fn();
let statsError: OcApiError | undefined;
const stats: OverviewStats = {
  totalSessions: 1,
  totalMessages: 1,
  totalTokens: { input: 1, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  totalCost: { amount: 0, priced: false },
  storedCostComparison: 0,
  activeDays: 1,
  avgSessionLengthMs: 1,
  sessionsThisWeek: 1,
  sessionsThisMonth: 1,
  unknownAgentCount: 0,
  unknownModelCount: 0,
  modelBreakdown: [],
  projectBreakdown: [],
  dailyActivity: [],
  dailyTokens: [],
  hourOfDay: [],
  costBreakdown: { totalCost: { amount: 0, priced: false }, storedCostComparison: 0, byModel: [], byProject: [], byDay: [], bySession: [], byAgent: [] },
};

vi.mock("@/hooks/use-oc", () => ({
  useOc: (route: string) => {
    if (route.startsWith("/api/stats")) return { data: { data: stats, meta: { generatedAt: 1, schemaVersion: "test", warnings: [] } }, error: statsError, isLoading: false, mutate: vi.fn() };
    if (route.startsWith("/api/activity")) return { data: undefined, error: new OcApiError({ code: "activity_failed", message: "Activity unavailable" }, 500), isLoading: false, mutate: activityRetry };
    if (route.startsWith("/api/sessions")) return { data: undefined, error: new OcApiError({ code: "sessions_failed", message: "Sessions unavailable" }, 500), isLoading: false, mutate: sessionsRetry };
    return { data: undefined, error: undefined, isLoading: false, mutate: vi.fn() };
  },
}));
vi.mock("@/components/overview/stat-grid", () => ({ StatGrid: () => <div>stats</div> }));
vi.mock("@/components/overview/storage-panel", () => ({ StoragePanel: () => <div>storage</div> }));
vi.mock("@/components/overview/usage-over-time-chart", () => ({ UsageOverTimeChart: () => <div>usage</div> }));
vi.mock("@/components/overview/peak-hours-chart", () => ({ PeakHoursChart: () => <div>hours</div> }));
vi.mock("@/components/overview/activity-heatmap", () => ({ ActivityHeatmap: () => <div>heatmap empty state</div> }));
vi.mock("@/components/overview/model-breakdown-donut", () => ({ ModelBreakdownDonut: () => <div>models</div> }));
vi.mock("@/components/overview/project-activity-donut", () => ({ ProjectActivityDonut: () => <div>projects</div> }));
vi.mock("@/components/overview/token-breakdown-panel", () => ({ TokenBreakdownPanel: () => <div>tokens</div> }));
vi.mock("@/components/overview/recent-sessions-table", () => ({ RecentSessionsTable: () => <div>recent empty state</div> }));

import { OverviewClient } from "./overview-client";

describe("OCL-142 overview dependency failures", () => {
  beforeEach(() => { statsError = undefined; });

  it("renders retryable errors rather than feeding failed requests to empty-state components", () => {
    const markup = renderToStaticMarkup(<OverviewClient />);
    expect(markup).toContain("Activity heatmap could not be loaded");
    expect(markup).toContain("Activity unavailable");
    expect(markup).toContain("Recent sessions could not be loaded");
    expect(markup).toContain("Sessions unavailable");
    expect(markup).not.toContain("heatmap empty state");
    expect(markup).not.toContain("recent empty state");
    expect(markup.match(/>Retry</g)).toHaveLength(2);
  });

  it("does not render stale analytics when SWR retains data alongside a stats error", () => {
    statsError = new OcApiError({ code: "stats_failed", message: "Stats unavailable" }, 500);
    const markup = renderToStaticMarkup(<OverviewClient />);
    expect(markup).toContain("Stats unavailable");
    expect(markup).not.toContain("stats</div>");
    expect(markup).not.toContain("usage</div>");
    expect(markup).not.toContain("models</div>");
    expect(markup).not.toContain("tokens</div>");
  });
});
