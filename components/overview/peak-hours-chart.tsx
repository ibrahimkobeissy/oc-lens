"use client";

import { BarChartCard } from "@/components/charts/bar-chart-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { HourBucket } from "@/types/oc";

export function peakHourRows(hours: readonly HourBucket[]): Array<{ hour: string; sessions: number }> {
  return [...hours].sort((left, right) => left.hour - right.hour).map((bucket) => ({
    hour: `${bucket.hour.toString().padStart(2, "0")}:00`,
    sessions: bucket.count,
  }));
}

export function PeakHoursChart({ hours }: { hours: HourBucket[] }) {
  const rows = peakHourRows(hours);
  const data = rows.some((row) => row.sessions > 0) ? rows : [];
  return (
    <Card className="min-w-0">
      <CardHeader><CardTitle>Peak hours</CardTitle><CardDescription>Session starts by hour in your local timezone.</CardDescription></CardHeader>
      <CardContent>
        <BarChartCard data={data} xKey="hour" xLabel="Local hour" series={[{ key: "sessions", label: "Sessions" }]} emptyMessage="No session starts were recorded in this range." height={300} />
      </CardContent>
    </Card>
  );
}
