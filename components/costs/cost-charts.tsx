"use client";

import { BarChartCard } from "@/components/charts/bar-chart-card";
import { LineChartCard } from "@/components/charts/line-chart-card";
import { Card, CardContent } from "@/components/ui/card";
import type { CostBreakdown } from "@/types/oc";

export function chartData(costs: CostBreakdown) {
  const byDay = costs.byDay.filter((row) => row.cost.priced).map((row) => ({ date: row.date, cost: row.cost.amount }));
  const byProject = costs.byProject.filter((row) => row.cost.priced).map((row) => ({ project: row.projectId, cost: row.cost.amount })).sort((a, b) => b.cost - a.cost || a.project.localeCompare(b.project));
  const byAgent = costs.byAgent.filter((row) => row.cost.priced).map((row) => ({ agent: row.agent, cost: row.cost.amount })).sort((a, b) => b.cost - a.cost || a.agent.localeCompare(b.agent));
  return { byDay, byProject, byAgent };
}

export function CostCharts({ costs }: { costs: CostBreakdown }) {
  const data = chartData(costs);
  const series = [{ key: "cost", label: "Configured cost (USD)" }];
  return (
    <section aria-label="Cost charts" className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2"><CardContent><LineChartCard title="Cost over time" data={data.byDay} xKey="date" xLabel="Date" series={series} emptyMessage="No priced model costs in this range." /></CardContent></Card>
      <Card><CardContent><BarChartCard title="Cost by project" data={data.byProject} xKey="project" xLabel="Project" series={series} emptyMessage="No priced project costs in this range." /></CardContent></Card>
      <Card><CardContent><BarChartCard title="Cost by agent" data={data.byAgent} xKey="agent" xLabel="Agent" series={series} emptyMessage="No priced agent costs in this range." /></CardContent></Card>
    </section>
  );
}
