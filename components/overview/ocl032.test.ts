import { describe, expect, it } from "vitest";

import { buildHeatmapWeeks, sessionHrefForDate } from "@/components/overview/activity-heatmap";
import { peakHourRows } from "@/components/overview/peak-hours-chart";
import { usageRows } from "@/components/overview/usage-over-time-chart";

const MAX_LOCAL_DAY_MS = 25 * 60 * 60 * 1_000;

describe("OCL-032 overview chart transforms", () => {
  it("merges messages and all token classes by day", () => {
    expect(usageRows(
      [{ date: "2026-01-02", sessionCount: 1, messageCount: 4, toolCallCount: 2 }],
      [{ date: "2026-01-02", tokens: { input: 10, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5 } }],
    )).toEqual([{ date: "2026-01-02", messages: 4, tokens: 24 }]);
  });

  it("orders all 24 local-hour buckets and preserves zeroes", () => {
    const rows = peakHourRows(Array.from({ length: 24 }, (_, hour) => ({ hour: 23 - hour, count: hour })));
    expect(rows).toHaveLength(24);
    expect(rows[0]).toEqual({ hour: "00:00", sessions: 23 });
    expect(rows[23]).toEqual({ hour: "23:00", sessions: 0 });
  });

  it("builds exactly 365 aligned real days with distinct zero and active values", () => {
    const weeks = buildHeatmapWeeks([{ date: "2026-01-04", sessionCount: 1, messageCount: 0, toolCallCount: 0 }], "2026-01-04");
    const real = weeks.flat().filter((cell) => cell.value !== null);
    expect(real).toHaveLength(365);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(real.at(-1)).toEqual({ label: "2026-01-04", value: 1 });
    expect(real.some((cell) => cell.value === 0)).toBe(true);
  });

  it("links one local calendar day to the sessions page using a half-open range", () => {
    const href = sessionHrefForDate("2026-01-15");
    const params = new URL(href, "http://localhost").searchParams;
    const from = Number(params.get("from"));
    const to = Number(params.get("to"));
    expect(href).toMatch(/^\/sessions\?from=\d+&to=\d+$/);
    expect(to).toBeGreaterThan(from);
    expect(new Date(from).getDate()).toBe(15);
    expect(new Date(to).getDate()).toBe(16);
    expect(to - from).toBeLessThanOrEqual(MAX_LOCAL_DAY_MS);
  });
});
