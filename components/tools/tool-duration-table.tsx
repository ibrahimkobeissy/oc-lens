"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { EmptyState } from "@/components/states/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePager, useClientPaging } from "@/components/ui/table-pager";
import { formatDuration, formatNumber } from "@/lib/format";
import { toolDisplayName } from "@/lib/tools";
import type { ToolSummary } from "@/types/oc";

export type DurationSort = "tool" | "category" | "calls" | "p50" | "p95";
type Order = "asc" | "desc";

const COLUMNS: Array<{ id: DurationSort; label: string; numeric: boolean }> = [
  { id: "tool", label: "Tool", numeric: false },
  { id: "category", label: "Category", numeric: false },
  { id: "calls", label: "Calls", numeric: true },
  { id: "p50", label: "p50", numeric: true },
  { id: "p95", label: "p95", numeric: true },
];

function sortValue(tool: ToolSummary, sort: DurationSort): string | number | null {
  switch (sort) {
    case "tool": return toolDisplayName(tool.tool).toLowerCase();
    case "category": return tool.category;
    case "calls": return tool.totalCalls;
    case "p50": return tool.p50DurationMs;
    case "p95": return tool.p95DurationMs;
  }
}

/** Sorts by any column; a tool with no timing evidence always sorts last, whichever direction. Ties fall back to calls, then name. */
export function sortToolDurations(tools: readonly ToolSummary[], sort: DurationSort, order: Order): ToolSummary[] {
  const direction = order === "asc" ? 1 : -1;
  return [...tools].sort((left, right) => {
    const l = sortValue(left, sort);
    const r = sortValue(right, sort);
    if (l === null && r !== null) return 1;
    if (r === null && l !== null) return -1;
    const primary = l === null || r === null ? 0 : typeof l === "number" && typeof r === "number" ? l - r : String(l).localeCompare(String(r));
    return primary * direction || right.totalCalls - left.totalCalls || left.tool.localeCompare(right.tool);
  });
}

export function ToolDurationTable({ tools }: { tools: ToolSummary[] }) {
  const [sort, setSort] = useState<DurationSort>("calls");
  const [order, setOrder] = useState<Order>("desc");
  const { visible, pagerProps, resetPage } = useClientPaging(sortToolDurations(tools, sort, order), 10);
  if (tools.length === 0) return <EmptyState title="No timing data" description="Tool durations will appear after timed calls are recorded." />;
  const sortBy = (column: (typeof COLUMNS)[number]) => {
    // A new column starts in its natural direction: numbers largest first, text A→Z.
    if (column.id === sort) setOrder(order === "desc" ? "asc" : "desc");
    else { setSort(column.id); setOrder(column.numeric ? "desc" : "asc"); }
    resetPage();
  };
  return (
    <section className="space-y-3" aria-labelledby="tool-durations-heading">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <header className="border-b border-border p-4"><h2 id="tool-durations-heading" className="font-semibold">Tool durations</h2><p className="mt-1 text-xs text-muted-foreground">Median and 95th-percentile completed-call duration.</p></header>
        <Table>
          <TableHeader><TableRow>{COLUMNS.map((column) => {
            const Icon = sort !== column.id ? ArrowUpDown : order === "asc" ? ArrowUp : ArrowDown;
            return <TableHead key={column.id} className={column.numeric ? "text-right" : undefined} aria-sort={sort === column.id ? (order === "asc" ? "ascending" : "descending") : "none"}>
              <button type="button" className="inline-flex items-center gap-1 hover:text-primary" onClick={() => sortBy(column)}>{column.label}<Icon aria-hidden="true" className="size-3.5" /><span className="sr-only">Sort by {column.label}</span></button>
            </TableHead>;
          })}</TableRow></TableHeader>
          <TableBody>{visible.map((tool) => <TableRow key={tool.tool}>
            <TableCell className="font-medium">{toolDisplayName(tool.tool)}</TableCell><TableCell className="capitalize text-muted-foreground">{tool.category}</TableCell><TableCell className="text-right font-mono">{formatNumber(tool.totalCalls)}</TableCell><TableCell className="text-right font-mono">{formatDuration(tool.p50DurationMs)}</TableCell><TableCell className="text-right font-mono">{formatDuration(tool.p95DurationMs)}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </div>
      <TablePager noun={["tool", "tools"]} {...pagerProps} />
    </section>
  );
}
