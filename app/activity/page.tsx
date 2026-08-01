"use client";

import { useState, useSyncExternalStore } from "react";
import { Activity } from "lucide-react";

import { DailyActivityChart } from "@/components/activity/daily-activity-chart";
import { DayOfWeekChart } from "@/components/activity/day-of-week-chart";
import { StreakCard } from "@/components/activity/streak-card";
import { BarChartCard } from "@/components/charts/bar-chart-card";
import { ChartSkeleton } from "@/components/states/chart-skeleton";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Onboarding } from "@/components/states/onboarding";
import { SchemaMismatch } from "@/components/states/schema-mismatch";
import { WarningsBanner } from "@/components/states/warnings-banner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOc } from "@/hooks/use-oc";
import { schemaVersion } from "@/lib/db/schema-guard";

type ActivityRange = "7d" | "30d" | "90d" | "all";

const subscribeBrowserSettings = () => () => undefined;

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function browserLocale(): string {
  return typeof navigator === "undefined" ? "en-US" : navigator.language;
}

function LoadingPage() {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="space-y-2">
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-72 max-w-full animate-pulse rounded bg-muted" />
      </div>
      <Card><CardContent><ChartSkeleton height={320} /></CardContent></Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardContent><ChartSkeleton height={280} /></CardContent></Card>
        <Card><CardContent><ChartSkeleton height={280} /></CardContent></Card>
      </div>
    </div>
  );
}

export default function ActivityPage() {
  const [range, setRange] = useState<ActivityRange>("30d");
  const timeZone = useSyncExternalStore(subscribeBrowserSettings, browserTimeZone, () => "UTC");
  const locale = useSyncExternalStore(subscribeBrowserSettings, browserLocale, () => "en-US");
  const route = `/api/activity?range=${range}&tz=${encodeURIComponent(timeZone)}` as const;
  const { data, error, isLoading, isValidating, mutate } = useOc(route);

  if (isLoading || (!data && !error)) return <LoadingPage />;
  if (error?.isDatabaseNotFound) return <Onboarding />;
  if (error?.isSchemaMismatch) return <SchemaMismatch schemaVersion={schemaVersion} message={error.message} />;
  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState message={error.message} onRetry={() => void mutate()} />
      </div>
    );
  }
  if (!data) return <LoadingPage />;

  const activity = data.data;
  const isEmpty = activity.dailyActivity.length === 0 &&
    activity.hourOfDay.every((bucket) => bucket.count === 0) &&
    activity.dayOfWeek.every((bucket) => bucket.count === 0);
  const hours = activity.hourOfDay.map((bucket) => ({
    hour: `${String(bucket.hour).padStart(2, "0")}:00`,
    sessions: bucket.count,
  }));
  const hourData = hours.some((bucket) => bucket.sessions > 0) ? hours : [];

  return (
    <div className="min-w-0 space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
          <p className="mt-1 text-sm text-muted-foreground">When your opencode sessions and events happen.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            <span className="block">Range</span>
            <Select value={range} onValueChange={(value) => setRange(value as ActivityRange)}>
              <SelectTrigger aria-label="Activity range" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <div className="pb-2 text-xs text-muted-foreground" aria-live="polite">
            {isValidating ? "Refreshing…" : timeZone}
          </div>
        </div>
      </div>

      <WarningsBanner warnings={data.meta.warnings} />

      <StreakCard streaks={activity.streaks} locale={locale} />

      {isEmpty ? (
        <EmptyState
          icon={<Activity aria-hidden="true" />}
          title="No activity in this range"
          description="Choose a wider range, or start an opencode session to populate these charts."
        />
      ) : (
        <>
          <DailyActivityChart data={activity.dailyActivity} />
          <div className="grid min-w-0 gap-6 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Hour of day</CardTitle>
                <CardDescription>Session starts in your local timezone.</CardDescription>
              </CardHeader>
              <CardContent>
                <BarChartCard
                  data={hourData}
                  xKey="hour"
                  xLabel="Local hour"
                  series={[{ key: "sessions", label: "Sessions" }]}
                  emptyMessage="No session starts were recorded in this range."
                  height={280}
                />
              </CardContent>
            </Card>
            <DayOfWeekChart data={activity.dayOfWeek} locale={locale} />
          </div>
        </>
      )}
    </div>
  );
}
