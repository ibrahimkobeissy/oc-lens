"use client";

import { useState, useSyncExternalStore } from "react";

import { FailureReport } from "@/components/audit/failure-report";
import { SlowStarts } from "@/components/audit/slow-starts";
import { ChartSkeleton } from "@/components/states/chart-skeleton";
import { ErrorState } from "@/components/states/error-state";
import { Onboarding } from "@/components/states/onboarding";
import { SchemaMismatch } from "@/components/states/schema-mismatch";
import { Card, CardContent } from "@/components/ui/card";
import { useOc } from "@/hooks/use-oc";
import { schemaVersion } from "@/lib/db/schema-guard";

type AuditRange = "7d" | "30d" | "90d" | "all";
const subscribeBrowser = () => () => undefined;

function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

function LoadingAudit() {
  return <div className="space-y-5 p-4 sm:p-6" role="status" aria-label="Loading provider audit"><div className="h-16 animate-pulse rounded-lg bg-muted" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((index) => <div key={index} className="h-32 animate-pulse rounded-lg bg-muted" />)}</div><Card><CardContent><ChartSkeleton height={280} /></CardContent></Card></div>;
}

export default function AuditPage() {
  const [range, setRange] = useState<AuditRange>("30d");
  const timeZone = useSyncExternalStore(subscribeBrowser, browserTimeZone, () => "UTC");
  const { data, error, isLoading, mutate } = useOc(`/api/audit/failures?range=${range}&tz=${encodeURIComponent(timeZone)}`);
  const slow = useOc(`/api/audit/slow-starts?range=${range}&tz=${encodeURIComponent(timeZone)}`);

  if (isLoading || (!data && !error)) return <LoadingAudit />;
  if (error?.isDatabaseNotFound) return <Onboarding />;
  if (error?.isSchemaMismatch) return <SchemaMismatch schemaVersion={schemaVersion} message={error.message} />;
  if (error) return <div className="p-4 sm:p-6"><ErrorState title="Provider audit could not be loaded" message={error.message} onRetry={() => void mutate()} /></div>;
  if (!data) return <LoadingAudit />;

  return (
    <div className="min-w-0 space-y-5 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-semibold">Provider audit</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">When a model call failed, how opencode resent it, and what the resend paid.</p></div>
        <label className="space-y-1 text-xs font-medium text-muted-foreground"><span className="block">Range</span><select aria-label="Audit range" className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground" value={range} onChange={(event) => setRange(event.target.value as AuditRange)}><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="all">All time</option></select></label>
      </header>
      <FailureReport report={data.data} />
      {slow.error ? <ErrorState title="Slow starts could not be loaded" message={slow.error.message} onRetry={() => void slow.mutate()} /> : slow.data ? <SlowStarts report={slow.data.data} /> : <Card><CardContent><ChartSkeleton height={160} /></CardContent></Card>}
    </div>
  );
}
