"use client";

import { ChevronRight } from "lucide-react";

import { formatCost, formatNumber } from "@/lib/format";
import type { DailyUsageRow } from "@/lib/pricing/breakdown";

function totalTokens(row: DailyUsageRow): number {
  return row.tokens.input + row.tokens.output + row.tokens.reasoning + row.tokens.cacheRead + row.tokens.cacheWrite;
}

/** "not priced" when nothing was priced; a sum missing some messages is labelled partial, never shown as the total. */
export function dailyCostLabel(row: Pick<DailyUsageRow, "messages" | "pricedAmount" | "unpricedMessages">): string {
  if (row.unpricedMessages >= row.messages) return formatCost({ amount: 0, priced: false });
  const amount = formatCost({ amount: row.pricedAmount, priced: true });
  return row.unpricedMessages === 0 ? amount : `${amount} (partial)`;
}

export function dailyUsageTotal(rows: readonly DailyUsageRow[]): DailyUsageRow {
  const total: DailyUsageRow = { date: "total", messages: 0, tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, pricedAmount: 0, unpricedMessages: 0 };
  for (const row of rows) {
    total.messages += row.messages;
    total.tokens.input += row.tokens.input;
    total.tokens.output += row.tokens.output;
    total.tokens.reasoning += row.tokens.reasoning;
    total.tokens.cacheRead += row.tokens.cacheRead;
    total.tokens.cacheWrite += row.tokens.cacheWrite;
    total.pricedAmount += row.pricedAmount;
    total.unpricedMessages += row.unpricedMessages;
  }
  return total;
}

function dayLabel(date: string): string {
  // Noon keeps the label on the same calendar day in every viewer time zone.
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

const cell = "px-3 py-2 text-right font-mono";

function UsageCells({ row }: { row: DailyUsageRow }) {
  return <>
    <td className={cell}>{formatNumber(row.messages)}</td>
    <td className={cell}>{formatNumber(row.tokens.input)}</td>
    <td className={cell}>{formatNumber(row.tokens.output)}</td>
    <td className={cell}>{formatNumber(row.tokens.reasoning)}</td>
    <td className={cell}>{formatNumber(row.tokens.cacheRead)}</td>
    <td className={cell}>{formatNumber(row.tokens.cacheWrite)}</td>
    <td className={`${cell} font-medium`}>{formatNumber(totalTokens(row))}</td>
    <td className={`${cell} ${row.unpricedMessages >= row.messages ? "text-muted-foreground" : ""}`}>{dailyCostLabel(row)}</td>
  </>;
}

export function DailyCostTable({ rows }: { rows: readonly DailyUsageRow[] }) {
  const total = dailyUsageTotal(rows);
  return (
    <details open className="group overflow-hidden rounded-lg border border-border bg-card shadow-xs">
      <summary className="flex cursor-pointer list-none items-start gap-2 p-4 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <div><h2 className="font-semibold">Daily usage</h2><p className="mt-1 text-xs text-muted-foreground">Tokens and configured cost per day in the selected range, newest first. Days without assistant activity are omitted.</p></div>
      </summary>
      {rows.length === 0 ? <p className="border-t border-border p-4 text-sm text-muted-foreground">No assistant usage in this range.</p> : (
        <div className="max-w-full overflow-x-auto border-t border-border">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Day</th><th className="px-3 py-2 text-right font-medium">Messages</th><th className="px-3 py-2 text-right font-medium">Input</th><th className="px-3 py-2 text-right font-medium">Output</th><th className="px-3 py-2 text-right font-medium">Reasoning</th><th className="px-3 py-2 text-right font-medium">Cache read</th><th className="px-3 py-2 text-right font-medium">Cache write</th><th className="px-3 py-2 text-right font-medium">Total tokens</th><th className="px-3 py-2 text-right font-medium">Cost</th></tr></thead>
            <tbody className="divide-y divide-border">{rows.map((row) => <tr key={row.date}><td className="whitespace-nowrap px-3 py-2"><time suppressHydrationWarning dateTime={row.date}>{dayLabel(row.date)}</time></td><UsageCells row={row} /></tr>)}</tbody>
            {rows.length > 1 ? <tfoot className="border-t border-border bg-muted/30 font-medium"><tr><td className="px-3 py-2">All days</td><UsageCells row={total} /></tr></tfoot> : null}
          </table>
        </div>
      )}
    </details>
  );
}
