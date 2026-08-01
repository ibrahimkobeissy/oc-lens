"use client";

import { BarChartCard } from "@/components/charts/bar-chart-card";
import type { AgentActivityPoint } from "@/types/oc";

export interface AgentActivityChartData {
  data: Array<Record<string, string | number>>;
  series: Array<{ key: string; label: string }>;
}

export function agentActivityChartData(points: readonly AgentActivityPoint[]): AgentActivityChartData {
  const agents = [...new Set(points.map((point) => point.agent))].sort((left, right) => left.localeCompare(right));
  const days = new Map<string, Record<string, string | number>>();
  for (const point of points) {
    const row = days.get(point.date) ?? { date: point.date };
    row[point.agent] = Number(row[point.agent] ?? 0) + point.messageCount;
    days.set(point.date, row);
  }
  const data = [...days.values()].sort((left, right) => String(left.date).localeCompare(String(right.date))).map((row) => {
    for (const agent of agents) if (row[agent] === undefined) row[agent] = 0;
    return row;
  });
  return { data, series: agents.map((agent) => ({ key: agent, label: agent })) };
}

export function AgentActivityChart({ points }: { points: AgentActivityPoint[] }) {
  const chart = agentActivityChartData(points);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <BarChartCard
        title="Agent messages over time"
        data={chart.data}
        xKey="date"
        xLabel="UTC date"
        series={chart.series}
        stacked
        emptyMessage="No agent message activity is available."
      />
    </div>
  );
}
