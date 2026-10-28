"use client";

import { CollapsibleSection } from "@/components/layout/collapsible-section";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCost, formatNumber } from "@/lib/format";
import type { OcTokens, ReplayTurn } from "@/types/oc";

export interface DailyTokenRow {
  day: string; // YYYY-MM-DD in the viewer's local time zone
  messages: number;
  tokens: OcTokens;
  total: number;
  costAmount: number;
  pricedMessages: number;
}

function safe(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function localDayKey(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function emptyRow(day: string): DailyTokenRow {
  return { day, messages: 0, tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, total: 0, costAmount: 0, pricedMessages: 0 };
}

function addTurn(row: DailyTokenRow, tokens: OcTokens, turn: Pick<ReplayTurn, "cost">): void {
  row.messages += 1;
  row.tokens.input += safe(tokens.input);
  row.tokens.output += safe(tokens.output);
  row.tokens.reasoning += safe(tokens.reasoning);
  row.tokens.cacheRead += safe(tokens.cacheRead);
  row.tokens.cacheWrite += safe(tokens.cacheWrite);
  row.total = row.tokens.input + row.tokens.output + row.tokens.reasoning + row.tokens.cacheRead + row.tokens.cacheWrite;
  if (turn.cost.priced && Number.isFinite(turn.cost.amount)) {
    row.costAmount += turn.cost.amount;
    row.pricedMessages += 1;
  }
}

/**
 * Per-message usage (`message.data.tokens`) grouped by the local calendar day
 * the message was created. Turns without token evidence (user turns, lifecycle
 * events) are not counted as messages here.
 */
export function dailyTokenRows(turns: readonly Pick<ReplayTurn, "timeCreated" | "tokens" | "cost">[]): { days: DailyTokenRow[]; total: DailyTokenRow } {
  const byDay = new Map<string, DailyTokenRow>();
  const total = emptyRow("total");
  for (const turn of turns) {
    if (turn.tokens === null || !Number.isFinite(turn.timeCreated)) continue;
    const day = localDayKey(turn.timeCreated);
    let row = byDay.get(day);
    if (!row) { row = emptyRow(day); byDay.set(day, row); }
    addTurn(row, turn.tokens, turn);
    addTurn(total, turn.tokens, turn);
  }
  return { days: [...byDay.values()].sort((left, right) => left.day.localeCompare(right.day)), total };
}

/** "not priced" unless every counted message was priced; a partial sum is labelled, never passed off as the total. */
export function dailyCostLabel(row: DailyTokenRow): string {
  if (row.pricedMessages === 0) return formatCost({ amount: 0, priced: false });
  const amount = formatCost({ amount: row.costAmount, priced: true });
  return row.pricedMessages === row.messages ? amount : `${amount} (partial)`;
}

function dayLabel(day: string): string {
  // Noon local time keeps the label on the same calendar day across DST shifts.
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

function UsageCells({ row }: { row: DailyTokenRow }) {
  return <>
    <TableCell className="text-right font-mono">{formatNumber(row.messages)}</TableCell>
    <TableCell className="text-right font-mono">{formatNumber(row.tokens.input)}</TableCell>
    <TableCell className="text-right font-mono">{formatNumber(row.tokens.output)}</TableCell>
    <TableCell className="text-right font-mono">{formatNumber(row.tokens.reasoning)}</TableCell>
    <TableCell className="text-right font-mono">{formatNumber(row.tokens.cacheRead)}</TableCell>
    <TableCell className="text-right font-mono">{formatNumber(row.tokens.cacheWrite)}</TableCell>
    <TableCell className="text-right font-mono font-medium">{formatNumber(row.total)}</TableCell>
    <TableCell className="text-right font-mono">{dailyCostLabel(row)}</TableCell>
  </>;
}

export function DailyTokenTable({ turns }: { turns: readonly ReplayTurn[] }) {
  const { days, total } = dailyTokenRows(turns);
  return (
    <CollapsibleSection aria-label="Tokens by day" title="Tokens by day" description="Per-message usage grouped by the local day each message started. Subagent sessions are not included." bodyClassName="p-0">
      {days.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No message in this session reported token usage.</p>
      ) : (
        <div>
          <Table>
            <TableHeader><TableRow><TableHead>Day</TableHead><TableHead className="text-right">Messages</TableHead><TableHead className="text-right">Input</TableHead><TableHead className="text-right">Output</TableHead><TableHead className="text-right">Reasoning</TableHead><TableHead className="text-right">Cache read</TableHead><TableHead className="text-right">Cache write</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader>
            <TableBody>{days.map((row) => <TableRow key={row.day}><TableCell className="whitespace-nowrap"><time suppressHydrationWarning dateTime={row.day}>{dayLabel(row.day)}</time></TableCell><UsageCells row={row} /></TableRow>)}</TableBody>
            {days.length > 1 ? <TableFooter><TableRow><TableCell className="font-medium">All days</TableCell><UsageCells row={total} /></TableRow></TableFooter> : null}
          </Table>
        </div>
      )}
    </CollapsibleSection>
  );
}
