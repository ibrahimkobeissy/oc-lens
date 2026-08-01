"use client";
import { LineChartCard } from "@/components/charts/line-chart-card";
import type { SessionTodos } from "@/types/oc";

export function CompletionChart({ sessions }: { sessions: SessionTodos[] }) {
  const days = new Map<string, { total: number; completed: number }>();
  for (const session of sessions) for (const todo of session.todos) {
    const date = new Date(todo.timeCreated).toISOString().slice(0, 10);
    const day = days.get(date) ?? { total: 0, completed: 0 }; day.total += 1; if (todo.status === "completed") day.completed += 1; days.set(date, day);
  }
  const data = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => ({ date, completionRate: day.total === 0 ? 0 : Math.round((day.completed / day.total) * 100) }));
  return <LineChartCard title="Completion rate by creation date" data={data} xKey="date" xLabel="Date" series={[{ key: "completionRate", label: "Completed (%)" }]} emptyMessage="No todo history is available." />;
}
