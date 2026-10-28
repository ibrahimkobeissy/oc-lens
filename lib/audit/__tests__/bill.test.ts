import { describe, expect, it } from "vitest";

import { BILL_TEMPLATE, parseBillCsv, reconcile } from "@/lib/audit/bill";
import type { DailyUsageRow } from "@/lib/pricing/breakdown";

const recorded = (date: string, input: number, output: number, pricedAmount = 0, unpricedMessages = 0): DailyUsageRow => ({
  date, messages: 1, tokens: { input, output, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, pricedAmount, unpricedMessages,
});

function parsed(text: string) {
  const bill = parseBillCsv(text);
  if (!bill.ok) throw new Error(bill.error);
  return bill;
}

describe("parseBillCsv", () => {
  it("reads the template and sums several rows for one day", () => {
    const bill = parsed(`${BILL_TEMPLATE}2026-10-01,100,5,0,0,0.10\n`);
    expect(bill.metrics).toEqual(["input", "output", "cacheRead", "cacheWrite", "cost"]);
    expect(bill.days).toEqual([{ date: "2026-10-01", values: { input: 1_200_100, output: 45_005, cacheRead: 800_000, cacheWrite: 0, cost: 4.3 } }]);
  });

  it("matches common provider headers, quoted fields, timestamps, and semicolon/decimal-comma exports", () => {
    expect(parsed('Start Time,Model,Prompt Tokens,Completion Tokens\n"2026-10-02T00:00:00Z","gpt, large","1,500",20\n').days)
      .toEqual([{ date: "2026-10-02", values: { input: 1_500, output: 20 } }]);
    expect(parsed("date;cost_usd\n2026-10-03;4,20\n").days).toEqual([{ date: "2026-10-03", values: { cost: 4.2 } }]);
  });

  it("explains what is missing instead of guessing", () => {
    expect(parseBillCsv("")).toEqual({ ok: false, error: "The file is empty." });
    expect(parseBillCsv("model,tokens\nx,1\n")).toMatchObject({ ok: false, error: expect.stringContaining("No date column") });
    expect(parseBillCsv("date,model\n2026-10-01,x\n")).toMatchObject({ ok: false, error: expect.stringContaining("No token or cost column") });
  });
});

describe("reconcile", () => {
  it("flags only days billed meaningfully above what opencode recorded", () => {
    const bill = parsed("date,input_tokens,output_tokens\n2026-10-01,100500,500\n2026-10-02,180000,1000\n2026-10-03,5000,0\n");
    const result = reconcile(bill, [recorded("2026-10-01", 100_000, 500), recorded("2026-10-02", 100_000, 1_000)]);
    expect(result.days.map((day) => [day.date, day.tokenGap, day.flagged])).toEqual([
      ["2026-10-01", 500, false],
      ["2026-10-02", 80_000, true],
      ["2026-10-03", 5_000, true],
    ]);
    expect(result).toMatchObject({ flaggedDays: 2, totalTokenGap: 85_500, billOnlyDays: 1, comparedMetrics: ["input", "output"] });
  });

  it("compares cost only when every message that day was priced", () => {
    const bill = parsed("date,cost_usd\n2026-10-01,5.00\n2026-10-02,5.00\n");
    const result = reconcile(bill, [recorded("2026-10-01", 1, 1, 2), recorded("2026-10-02", 1, 1, 2, 1)]);
    expect(result.days.map((day) => [day.recordedCost, day.flagged])).toEqual([[2, true], [null, false]]);
  });
});
