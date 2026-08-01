"use client";

import Link from "next/link";

import { LineChartCard } from "@/components/charts/line-chart-card";
import { EmptyState } from "@/components/states/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { formatNumber } from "@/lib/format";
import type { ToolActivityPoint, ToolErrorSummary, ToolSummary } from "@/types/oc";

export function toolErrorRate(tools: readonly ToolSummary[]): { errors: number; calls: number; pct: number } {
  const calls = tools.reduce((sum, tool) => sum + tool.totalCalls, 0);
  const errors = tools.reduce((sum, tool) => sum + tool.errorCount, 0);
  return { errors, calls, pct: calls === 0 ? 0 : (errors / calls) * 100 };
}

export function ToolErrorPanel({ tools, errors, activity }: { tools: ToolSummary[]; errors: ToolErrorSummary[]; activity: ToolActivityPoint[] }) {
  const total = toolErrorRate(tools);
  const byTool = [...tools].filter((tool) => tool.errorCount > 0).sort((left, right) => right.errorCount - left.errorCount || left.tool.localeCompare(right.tool));
  const timeline = activity.map((day) => ({ date: day.date, errorRate: day.totalCalls === 0 ? 0 : Number(((day.errorCount / day.totalCalls) * 100).toFixed(2)) }));
  return <section className="space-y-4" aria-labelledby="tool-errors-heading">
    <div><h2 id="tool-errors-heading" className="font-semibold">Tool errors</h2><p className="mt-1 text-xs text-muted-foreground">Failure rates use tool calls—not sessions—as the denominator.</p></div>
    <div className="grid gap-3 sm:grid-cols-3"><StatCard label="Errors" value={total.errors} /><StatCard label="Tool calls" value={total.calls} /><StatCard label="Error rate" value={`${total.pct.toFixed(1)}%`} /></div>
    {errors.length === 0 ? <EmptyState title="No tool errors" description="No failed tool calls were recorded in this range." /> : <>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4"><h3 className="text-sm font-medium">Errors by tool</h3><ul className="mt-3 divide-y divide-border text-sm">{byTool.map((tool) => <li key={tool.tool} className="flex justify-between py-2"><code>{tool.tool}</code><span>{formatNumber(tool.errorCount)} errors</span></li>)}</ul></div>
        <div className="rounded-lg border border-border bg-card p-4"><LineChartCard title="Error rate over time" data={timeline} xKey="date" series={[{ key: "errorRate", label: "Error rate (%)" }]} emptyMessage="No dated tool calls are available." /></div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card"><h3 className="border-b border-border p-4 text-sm font-medium">Recent errors</h3><ul className="divide-y divide-border">{errors.slice(0, 20).map((error) => <li key={error.partId} className="p-4"><div className="flex flex-wrap items-center gap-2 text-xs"><code>{error.tool}</code><span className="rounded bg-muted px-1.5 py-0.5">{error.category || "other"}</span><time suppressHydrationWarning className="text-muted-foreground" dateTime={new Date(error.timeCreated).toISOString()}>{new Date(error.timeCreated).toLocaleString()}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-sm">{error.message}</p><Link className="mt-2 inline-block text-xs font-medium text-primary hover:underline" href={`/sessions/${encodeURIComponent(error.sessionId)}?part=${encodeURIComponent(error.partId)}`}>Open exact replay turn</Link></li>)}</ul></div>
    </>}
  </section>;
}
