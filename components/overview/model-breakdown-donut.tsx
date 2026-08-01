"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";

import { EmptyState } from "@/components/states/empty-state";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { chartColor } from "@/components/charts/chart-colors";
import { formatNumber } from "@/lib/format";
import type { ModelUsage, OverviewStats } from "@/types/oc";

export interface BreakdownSlice {
  key: string;
  label: string;
  value: number;
  members?: string[];
}

const TOP_SLICE_COUNT = 8;

export function collapseBreakdownSlices(slices: readonly BreakdownSlice[]): BreakdownSlice[] {
  const sorted = slices
    .filter((slice) => Number.isFinite(slice.value) && slice.value > 0)
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label) || left.key.localeCompare(right.key));
  const unknown = sorted.filter((slice) => slice.key === "unknown");
  const ranked = sorted.filter((slice) => slice.key !== "unknown");
  const rankedLimit = Math.max(0, TOP_SLICE_COUNT - unknown.length);
  if (ranked.length <= rankedLimit) return [...ranked, ...unknown];
  const retained = ranked.slice(0, rankedLimit);
  const collapsed = ranked.slice(rankedLimit);
  return [
    ...retained,
    {
      key: "other",
      label: "other",
      value: collapsed.reduce((total, slice) => total + slice.value, 0),
      members: collapsed.map((slice) => slice.label),
    },
    ...unknown,
  ];
}

function modelLabel(model: Pick<ModelUsage, "providerID" | "modelID">): string {
  if (model.providerID === "unknown" || model.modelID === "unknown") return "unknown";
  return `${model.providerID}/${model.modelID}`;
}

export function modelBreakdownSlices(stats: Pick<OverviewStats, "modelBreakdown" | "unknownModelCount">): BreakdownSlice[] {
  const known = new Map<string, number>();
  let unknownFromMessages = 0;
  for (const model of stats.modelBreakdown) {
    const label = modelLabel(model);
    if (label === "unknown") unknownFromMessages += model.sessionCount;
    else known.set(label, (known.get(label) ?? 0) + model.sessionCount);
  }
  const unknown = stats.unknownModelCount > 0 ? stats.unknownModelCount : unknownFromMessages;
  return collapseBreakdownSlices([
    ...[...known].map(([label, value]) => ({ key: label, label, value })),
    ...(unknown > 0 ? [{ key: "unknown", label: "unknown", value: unknown }] : []),
  ]);
}

function sliceColor(slice: BreakdownSlice, index: number): string {
  if (slice.key === "other") return "var(--muted-foreground)";
  if (slice.key === "unknown") return chartColor(TOP_SLICE_COUNT - 1);
  return chartColor(index);
}

export function BreakdownDonut({
  title,
  slices,
  emptyMessage,
  valueLabel = "sessions",
}: {
  title: string;
  slices: BreakdownSlice[];
  emptyMessage: string;
  valueLabel?: string;
}) {
  if (slices.length === 0) return <EmptyState title={`No ${title.toLocaleLowerCase()} data`} description={emptyMessage} />;

  return (
    <section aria-label={title} className="w-full rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <div role="img" aria-label={`${title} donut chart`} className="h-56 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="label" innerRadius="55%" outerRadius="80%" paddingAngle={2}>
              {slices.map((slice, index) => <Cell key={slice.key} fill={sliceColor(slice, index)} />)}
            </Pie>
            <RechartsTooltip
              formatter={(value) => [`${formatNumber(Number(value))} ${valueLabel}`, "Activity"]}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--popover-foreground)",
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <TooltipProvider>
        <ul className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          {slices.map((slice, index) => (
            <li key={slice.key} className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: sliceColor(slice, index) }} />
              {slice.members ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="min-w-0 cursor-help truncate underline decoration-dotted underline-offset-2">{slice.label}</span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-80">
                    <p>Contains: {slice.members.join(", ")}</p>
                  </TooltipContent>
                </Tooltip>
              ) : <span className="min-w-0 truncate" title={slice.label}>{slice.label}</span>}
              <span className="ml-auto shrink-0 font-mono tabular-nums text-foreground">{formatNumber(slice.value)}</span>
              {slice.members && <span className="sr-only">Contains: {slice.members.join(", ")}</span>}
            </li>
          ))}
        </ul>
      </TooltipProvider>
      <div className="sr-only">
        <table>
          <caption>{title} underlying data</caption>
          <thead><tr><th scope="col">Label</th><th scope="col">{valueLabel}</th></tr></thead>
          <tbody>{slices.map((slice) => <tr key={slice.key}><td>{slice.label}</td><td>{slice.value}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

export function ModelBreakdownDonut({ stats }: { stats: OverviewStats }) {
  return (
    <BreakdownDonut
      title="Model breakdown"
      slices={modelBreakdownSlices(stats)}
      emptyMessage="No model activity is available for this range."
    />
  );
}
