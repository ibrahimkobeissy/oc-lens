"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartContainer } from "@/components/charts/chart-container";
import { EmptyState } from "@/components/states/empty-state";
import { categoryColor, toolDisplayName } from "@/lib/tools";
import type { ToolCategory, ToolSummary } from "@/types/oc";

const CATEGORIES: ToolCategory[] = ["file", "search", "exec", "web", "planning", "delegation", "other"];

export function rankedTools(tools: readonly ToolSummary[]): ToolSummary[] {
  return [...tools].filter((tool) => tool.totalCalls > 0).sort((left, right) => right.totalCalls - left.totalCalls || left.tool.localeCompare(right.tool));
}

export function categoryRollups(tools: readonly ToolSummary[]): Array<{ category: ToolCategory; calls: number }> {
  const counts = new Map<ToolCategory, number>(CATEGORIES.map((category) => [category, 0]));
  for (const tool of tools) counts.set(tool.category, (counts.get(tool.category) ?? 0) + tool.totalCalls);
  return CATEGORIES.map((category) => ({ category, calls: counts.get(category) ?? 0 }));
}

export function ToolRankingChart({ tools }: { tools: ToolSummary[] }) {
  const ranked = rankedTools(tools);
  const rollups = categoryRollups(tools);
  if (ranked.length === 0) return <EmptyState title="No tool calls" description="No tools were invoked in this range." />;
  const rows = ranked.map((tool) => ({ ...tool, label: toolDisplayName(tool.tool) }));
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div><h2 className="font-semibold">Tool ranking</h2><p className="mt-1 text-xs text-muted-foreground">Calls per tool, coloured by the shared opencode category taxonomy.</p></div>
      <ul aria-label="Tool category totals" className="flex flex-wrap gap-2">
        {rollups.map((rollup) => (
          <li key={rollup.category} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ background: categoryColor(rollup.category) }} />
            <span className="capitalize">{rollup.category}</span><span className="font-mono text-muted-foreground">{rollup.calls}</span>
          </li>
        ))}
      </ul>
      <ChartContainer ariaLabel="Tool calls ranked horizontally" height={Math.max(280, rows.length * 34)} srSummary={
        <table><caption>Tool call ranking</caption><thead><tr><th>Tool</th><th>Category</th><th>Calls</th></tr></thead><tbody>{rows.map((row) => <tr key={row.tool}><td>{row.label}</td><td>{row.category}</td><td>{row.totalCalls}</td></tr>)}</tbody></table>
      }>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ left: 20, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" allowDecimals={false} stroke="var(--muted-foreground)" fontSize={12} />
            <YAxis type="category" dataKey="label" width={100} stroke="var(--muted-foreground)" fontSize={12} />
            <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--popover-foreground)", fontSize: 12 }} />
            <Bar dataKey="totalCalls" name="Calls" radius={[0, 4, 4, 0]}>{rows.map((row) => <Cell key={row.tool} fill={categoryColor(row.category)} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </section>
  );
}
