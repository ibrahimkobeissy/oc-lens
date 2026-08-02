"use client";

import { useMemo, useState } from "react";

import { ActivityHeatmap } from "@/components/overview/activity-heatmap";
import { ModelBreakdownDonut } from "@/components/overview/model-breakdown-donut";
import { PeakHoursChart } from "@/components/overview/peak-hours-chart";
import { ProjectActivityDonut } from "@/components/overview/project-activity-donut";
import { RangePicker, type RangeSelection } from "@/components/overview/range-picker";
import { RecentSessionsTable } from "@/components/overview/recent-sessions-table";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Onboarding } from "@/components/states/onboarding";
import { SchemaMismatch } from "@/components/states/schema-mismatch";
import { WarningsBanner } from "@/components/states/warnings-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/states/table-skeleton";
import { StatGrid } from "@/components/overview/stat-grid";
import { StoragePanel } from "@/components/overview/storage-panel";
import { TokenBreakdownPanel } from "@/components/overview/token-breakdown-panel";
import { UsageOverTimeChart } from "@/components/overview/usage-over-time-chart";
import { useOc } from "@/hooks/use-oc";
import { schemaVersion } from "@/lib/db/schema-guard";

function StatGridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-label="Loading overview statistics">
      {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-28 rounded-lg" />)}
    </div>
  );
}

export function OverviewClient() {
  const [range, setRange] = useState<RangeSelection>({ kind: "preset", value: "30d" });
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const statsRoute = range.kind === "preset"
    ? (`/api/stats?range=${range.value}&tz=${encodeURIComponent(timeZone)}` as const)
    : (`/api/stats?from=${range.from}&to=${range.to}&tz=${encodeURIComponent(timeZone)}` as const);
  const yearActivityRoute = `/api/activity?range=all&tz=${encodeURIComponent(timeZone)}` as const;
  const stats = useOc(statsRoute);
  const recentSessionsRoute = useMemo(() => {
    const params = new URLSearchParams({ sort: "timeCreated", order: "desc", limit: "10" });
    const generatedAt = stats.data?.meta.generatedAt;
    if (range.kind === "custom") {
      params.set("from", `${range.from}`);
      params.set("to", `${range.to}`);
    } else if (range.value !== "all" && generatedAt !== undefined) {
      params.set("from", `${generatedAt - Number.parseInt(range.value, 10) * 86_400_000}`);
      params.set("to", `${generatedAt + 1}`);
    }
    return `/api/sessions?${params.toString()}` as const;
  }, [range, stats.data?.meta.generatedAt]);
  const yearActivity = useOc(yearActivityRoute);
  const recentSessions = useOc(recentSessionsRoute, { enabled: stats.data !== undefined });
  const settings = useOc("/api/settings", { polling: false });

  if (stats.error?.isDatabaseNotFound) return <Onboarding />;
  if (stats.error?.isSchemaMismatch) return <SchemaMismatch schemaVersion={schemaVersion} message={stats.error.message} />;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Local analytics</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your opencode activity, computed locally from the read-only database.</p>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </header>

      {stats.data && !stats.error && <WarningsBanner warnings={stats.data.meta.warnings} />}
      {stats.isLoading ? (
        <StatGridSkeleton />
      ) : stats.error ? (
        <ErrorState message={stats.error.message} onRetry={() => void stats.mutate()} />
      ) : !stats.data || stats.data.data.totalSessions === 0 ? (
        <EmptyState title="No activity in this range" description="Choose a wider range, or start an opencode session to populate the overview." />
      ) : (
        <StatGrid stats={stats.data.data} storageBytes={settings.data?.data.storage.totalBytes ?? null} />
      )}

      {settings.error && !stats.isLoading && !stats.error && (
        <p className="text-xs text-muted-foreground">Storage size is temporarily unavailable: {settings.error.message}</p>
      )}

      <StoragePanel />

      {stats.data && !stats.error && stats.data.data.totalSessions > 0 && (
        <>
          <UsageOverTimeChart activity={stats.data.data.dailyActivity} dailyTokens={stats.data.data.dailyTokens} />
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <PeakHoursChart hours={stats.data.data.hourOfDay} />
            {yearActivity.isLoading ? (
              <Skeleton className="h-96 rounded-lg" />
            ) : yearActivity.error ? (
              <ErrorState title="Activity heatmap could not be loaded" message={yearActivity.error.message} onRetry={() => void yearActivity.mutate()} />
            ) : (
              <ActivityHeatmap activity={yearActivity.data?.data.dailyActivity ?? []} timeZone={timeZone} now={yearActivity.data?.meta.generatedAt ?? stats.data.meta.generatedAt} />
            )}
            <ModelBreakdownDonut stats={stats.data.data} />
            <ProjectActivityDonut stats={stats.data.data} />
          </div>
          <TokenBreakdownPanel stats={stats.data.data} />
          {recentSessions.isLoading ? (
            <TableSkeleton rows={10} columns={8} />
          ) : recentSessions.error ? (
            <ErrorState title="Recent sessions could not be loaded" message={recentSessions.error.message} onRetry={() => void recentSessions.mutate()} />
          ) : (
            <RecentSessionsTable sessions={recentSessions.data?.data.sessions ?? []} />
          )}
        </>
      )}
    </div>
  );
}
