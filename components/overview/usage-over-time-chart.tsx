"use client";

import { useMemo, useState } from "react";

import { AreaChartCard } from "@/components/charts/area-chart-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DailyActivity, OcTokens } from "@/types/oc";

export type UsageMetric = "messages" | "tokens";

export function usageRows(
  activity: readonly DailyActivity[],
  dailyTokens: readonly { date: string; tokens: OcTokens }[],
): Array<{ date: string; messages: number; tokens: number }> {
  const rows = new Map<string, { date: string; messages: number; tokens: number }>();
  for (const day of activity) rows.set(day.date, { date: day.date, messages: day.messageCount, tokens: 0 });
  for (const day of dailyTokens) {
    const row = rows.get(day.date) ?? { date: day.date, messages: 0, tokens: 0 };
    row.tokens = day.tokens.input + day.tokens.output + day.tokens.reasoning + day.tokens.cacheRead + day.tokens.cacheWrite;
    rows.set(day.date, row);
  }
  return [...rows.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function UsageOverTimeChart({ activity, dailyTokens }: { activity: DailyActivity[]; dailyTokens: Array<{ date: string; tokens: OcTokens }> }) {
  const [metric, setMetric] = useState<UsageMetric>("messages");
  const rows = useMemo(() => usageRows(activity, dailyTokens), [activity, dailyTokens]);
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div><CardTitle>Usage over time</CardTitle><CardDescription>Messages and session-token totals by local calendar day.</CardDescription></div>
        <div className="flex gap-1" role="group" aria-label="Usage metric">
          {(["messages", "tokens"] as const).map((value) => (
            <Button key={value} type="button" size="sm" variant={metric === value ? "secondary" : "outline"} aria-pressed={metric === value} onClick={() => setMetric(value)}>
              {value === "messages" ? "Messages" : "Tokens"}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <AreaChartCard data={rows} xKey="date" xLabel="Local date" series={[{ key: metric, label: metric === "messages" ? "Messages" : "Tokens" }]} stacked={false} emptyMessage="No usage was recorded in this range." height={300} />
      </CardContent>
    </Card>
  );
}
