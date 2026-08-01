"use client";

import { BarChartCard } from "@/components/charts/bar-chart-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DayOfWeekBucket } from "@/types/oc";

interface WeekInfo {
  firstDay: number;
}

type LocaleWithWeekInfo = Intl.Locale & {
  getWeekInfo?: () => WeekInfo;
  weekInfo?: WeekInfo;
};

const SUNDAY_FIRST_REGIONS = new Set(["AU", "BR", "CA", "CN", "HK", "IL", "JP", "KR", "MX", "PH", "SG", "TH", "TW", "US"]);
const SATURDAY_FIRST_REGIONS = new Set(["AF", "BH", "DJ", "DZ", "EG", "IQ", "IR", "JO", "KW", "LY", "OM", "QA", "SD", "SY"]);

function firstDayOfWeek(localeName: string): number {
  try {
    const locale = new Intl.Locale(localeName) as LocaleWithWeekInfo;
    const firstDay = locale.getWeekInfo?.().firstDay ?? locale.weekInfo?.firstDay;
    if (typeof firstDay === "number") return firstDay % 7;
    const region = locale.region ?? locale.maximize().region;
    if (region && SATURDAY_FIRST_REGIONS.has(region)) return 6;
    if (region && SUNDAY_FIRST_REGIONS.has(region)) return 0;
  } catch {
    // Invalid browser locale: use the ISO-style Monday fallback below.
  }
  return 1;
}

function weekdayLabel(day: number, localeName: string): string {
  const sunday = Date.UTC(2024, 0, 7);
  return new Intl.DateTimeFormat(localeName, { weekday: "short", timeZone: "UTC" }).format(
    new Date(sunday + day * 86_400_000),
  );
}

export function DayOfWeekChart({ data, locale }: { data: DayOfWeekBucket[]; locale: string }) {
  const byDay = new Map(data.map((bucket) => [bucket.day, bucket.count]));
  const firstDay = firstDayOfWeek(locale);
  const ordered = Array.from({ length: 7 }, (_, offset) => {
    const day = (firstDay + offset) % 7;
    return { day: weekdayLabel(day, locale), sessions: byDay.get(day) ?? 0 };
  });
  const chartData = ordered.some((bucket) => bucket.sessions > 0) ? ordered : [];

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Day of week</CardTitle>
        <CardDescription>Session starts, ordered using your locale&apos;s first weekday.</CardDescription>
      </CardHeader>
      <CardContent>
        <BarChartCard
          data={chartData}
          xKey="day"
          xLabel="Weekday"
          series={[{ key: "sessions", label: "Sessions" }]}
          emptyMessage="No session starts were recorded in this range."
          height={280}
        />
      </CardContent>
    </Card>
  );
}
