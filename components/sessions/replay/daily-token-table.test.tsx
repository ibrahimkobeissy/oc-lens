import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { OcTokens, ReplayTurn } from "@/types/oc";
import { dailyCostLabel, dailyTokenRows, DailyTokenTable } from "./daily-token-table";

const tokens = (input: number, output: number, reasoning = 0, cacheRead = 0, cacheWrite = 0): OcTokens => ({ input, output, reasoning, cacheRead, cacheWrite });
const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();

function turn(timeCreated: number, usage: OcTokens | null, priced = true, amount = 0.5): ReplayTurn {
  return { messageId: `m${timeCreated}`, role: usage ? "assistant" : "user", agent: null, timeCreated, timeCompleted: null, durationMs: null, tokens: usage, cost: { amount: priced ? amount : 0, priced }, parts: [] };
}

describe("DailyTokenTable", () => {
  it("groups message usage by local day and totals every column", () => {
    const { days, total } = dailyTokenRows([
      turn(at(27, 23), tokens(100, 10, 5, 50, 2)),
      turn(at(27, 9), null),
      turn(at(28, 0), tokens(200, 20, 0, 0, 0)),
      turn(at(28, 12), tokens(1, 1, 1, 1, 1)),
    ]);

    expect(days.map((row) => [row.day, row.messages, row.total])).toEqual([["2026-10-27", 1, 167], ["2026-10-28", 2, 225]]);
    expect(total.tokens).toEqual(tokens(301, 31, 6, 51, 3));
    expect(total.total).toBe(392);
  });

  it("never shows a partial or missing price as a full cost", () => {
    const { days } = dailyTokenRows([turn(at(1, 1), tokens(1, 1)), turn(at(1, 2), tokens(1, 1), false), turn(at(2, 1), tokens(1, 1), false)]);
    const [mixed, unpriced] = days;
    if (!mixed || !unpriced) throw new Error("expected two days");
    expect(dailyCostLabel(mixed)).toBe("$0.50 (partial)");
    expect(dailyCostLabel(unpriced)).toBe("not priced");
  });

  it("ignores non-finite token evidence instead of rendering NaN", () => {
    const { total } = dailyTokenRows([turn(at(3, 1), tokens(Number.NaN, Number.POSITIVE_INFINITY, -1, 4, 0))]);
    expect(total.total).toBe(4);
  });

  it("renders a collapsed-by-default section and an empty state", () => {
    const html = renderToStaticMarkup(<DailyTokenTable turns={[turn(at(5, 5), tokens(10, 2))]} />);
    expect(html).toMatch(/<details aria-label="Tokens by day"/);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).toContain("Tokens by day");
    for (const label of ["Input", "Output", "Reasoning", "Cache read", "Cache write", "Total", "Cost"]) expect(html).toContain(label);
    expect(html).not.toContain("NaN");

    expect(renderToStaticMarkup(<DailyTokenTable turns={[]} />)).toContain("No message in this session reported token usage.");
  });
});
