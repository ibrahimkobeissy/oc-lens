import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DailyUsageRow } from "@/lib/pricing/breakdown";
import { dailyCostLabel, DailyCostTable, dailyUsageTotal } from "./daily-cost-table";

const row = (date: string, messages: number, pricedAmount: number, unpricedMessages: number): DailyUsageRow => ({
  date, messages, tokens: { input: 10, output: 5, reasoning: 1, cacheRead: 3, cacheWrite: 1 }, pricedAmount, unpricedMessages,
});

describe("DailyCostTable", () => {
  it("labels unpriced and partially priced days honestly", () => {
    expect(dailyCostLabel(row("2024-01-01", 2, 1.5, 0))).toBe("$1.50");
    expect(dailyCostLabel(row("2024-01-01", 2, 1.5, 1))).toBe("$1.50 (partial)");
    expect(dailyCostLabel(row("2024-01-01", 2, 0, 2))).toBe("not priced");
  });

  it("totals every column across days", () => {
    const total = dailyUsageTotal([row("2024-01-02", 1, 2, 0), row("2024-01-01", 2, 1, 1)]);
    expect(total).toMatchObject({ messages: 3, pricedAmount: 3, unpricedMessages: 1, tokens: { input: 20, output: 10, reasoning: 2, cacheRead: 6, cacheWrite: 2 } });
    expect(dailyCostLabel(total)).toBe("$3.00 (partial)");
  });

  it("renders an open collapsible table with a total row, and an empty state", () => {
    const html = renderToStaticMarkup(<DailyCostTable rows={[row("2024-01-02", 1, 2, 0), row("2024-01-01", 1, 1, 0)]} />);
    expect(html).toMatch(/<details open=""/);
    expect(html).toContain("Daily usage");
    expect(html).toContain("All days");
    expect(html).not.toContain("NaN");
    expect(renderToStaticMarkup(<DailyCostTable rows={[]} />)).toContain("No assistant usage in this range.");
  });
});
