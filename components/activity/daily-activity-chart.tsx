"use client";

import { useMemo, useState } from "react";

import { LineChartCard } from "@/components/charts/line-chart-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DailyActivity } from "@/types/oc";

const SERIES = [
  { key: "messageCount", label: "Messages" },
  { key: "sessionCount", label: "Sessions" },
  { key: "toolCallCount", label: "Tool calls" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

export function DailyActivityChart({ data }: { data: DailyActivity[] }) {
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({
    messageCount: true,
    sessionCount: true,
    toolCallCount: true,
  });
  const activeSeries = useMemo(() => SERIES.filter((series) => visible[series.key]), [visible]);

  function toggle(key: SeriesKey): void {
    setVisible((current) => {
      const activeCount = Object.values(current).filter(Boolean).length;
      if (current[key] && activeCount === 1) return current;
      return { ...current, [key]: !current[key] };
    });
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Daily activity</CardTitle>
        <CardDescription>Sessions started and events recorded on each local calendar day.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Daily activity series">
          {SERIES.map((series) => (
            <Button
              key={series.key}
              type="button"
              size="sm"
              variant={visible[series.key] ? "secondary" : "outline"}
              aria-pressed={visible[series.key]}
              onClick={() => toggle(series.key)}
            >
              {series.label}
            </Button>
          ))}
        </div>
        <LineChartCard
          data={data.map((day) => ({
            date: day.date,
            messageCount: day.messageCount,
            sessionCount: day.sessionCount,
            toolCallCount: day.toolCallCount,
          }))}
          xKey="date"
          xLabel="Local date"
          series={activeSeries.map((series) => ({ ...series }))}
          emptyMessage="No activity was recorded in this range."
          height={320}
        />
      </CardContent>
    </Card>
  );
}
