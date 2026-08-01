"use client";

import { BarChartCard } from "@/components/charts/bar-chart-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ToolErrorSummary } from "@/types/oc";

export function errorCategoryRows(errors: readonly ToolErrorSummary[]): Array<{ category: string; errors: number }> {
  const counts = new Map<string, number>();
  for (const error of errors) counts.set(error.category || "other", (counts.get(error.category || "other") ?? 0) + 1);
  return [...counts].map(([category, count]) => ({ category, errors: count })).sort((left, right) => right.errors - left.errors || left.category.localeCompare(right.category));
}

export function ErrorCategoryChart({ errors }: { errors: ToolErrorSummary[] }) {
  return <Card><CardHeader><CardTitle>Errors by category</CardTitle><CardDescription>Derived from the recorded raw error message; unmatched text remains other.</CardDescription></CardHeader><CardContent><BarChartCard data={errorCategoryRows(errors)} xKey="category" series={[{ key: "errors", label: "Errors" }]} emptyMessage="No tool errors were recorded in this range." /></CardContent></Card>;
}
