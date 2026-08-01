"use client";

import { useState, useSyncExternalStore } from "react";
import { CircleDollarSign } from "lucide-react";

import { CacheEfficiency } from "@/components/costs/cache-efficiency";
import { CostCharts } from "@/components/costs/cost-charts";
import { CostModelTable } from "@/components/costs/cost-model-table";
import { CostSummary } from "@/components/costs/cost-summary";
import { PricingBanner } from "@/components/costs/pricing-banner";
import { ChartSkeleton } from "@/components/states/chart-skeleton";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Onboarding } from "@/components/states/onboarding";
import { SchemaMismatch } from "@/components/states/schema-mismatch";
import { TableSkeleton } from "@/components/states/table-skeleton";
import { WarningsBanner } from "@/components/states/warnings-banner";
import { Card, CardContent } from "@/components/ui/card";
import { useOc } from "@/hooks/use-oc";
import { schemaVersion } from "@/lib/db/schema-guard";

type CostRange = "7d" | "30d" | "90d" | "all";
const subscribeBrowser = () => () => undefined;

function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

function LoadingCosts() {
  return <div className="space-y-5 p-4 sm:p-6"><div className="h-16 animate-pulse rounded-lg bg-muted" /><div className="grid gap-3 sm:grid-cols-2"><div className="h-32 animate-pulse rounded-lg bg-muted" /><div className="h-32 animate-pulse rounded-lg bg-muted" /></div><TableSkeleton rows={6} columns={8} /><Card><CardContent><ChartSkeleton height={280} /></CardContent></Card></div>;
}

export default function CostsPage() {
  const [range, setRange] = useState<CostRange>("30d");
  const timeZone = useSyncExternalStore(subscribeBrowser, browserTimeZone, () => "UTC");
  const route = `/api/costs?range=${range}&tz=${encodeURIComponent(timeZone)}` as const;
  const { data, error, isLoading, isValidating, mutate } = useOc(route);

  if (isLoading || (!data && !error)) return <LoadingCosts />;
  if (error?.isDatabaseNotFound) return <Onboarding />;
  if (error?.isSchemaMismatch) return <SchemaMismatch schemaVersion={schemaVersion} message={error.message} />;
  if (error) return <div className="p-4 sm:p-6"><ErrorState title="Costs could not be loaded" message={error.message} onRetry={() => void mutate()} /></div>;
  if (!data) return <LoadingCosts />;

  const costs = data.data;
  const unpriced = costs.byModel.filter((model) => !model.cost.priced).length;
  return (
    <div className="min-w-0 space-y-5 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-semibold">Costs</h1><p className="mt-1 text-sm text-muted-foreground">Your token usage multiplied by prices you entered—never a bundled estimate.</p></div><label className="space-y-1 text-xs font-medium text-muted-foreground"><span className="block">Range</span><select aria-label="Cost range" className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground" value={range} onChange={(event) => setRange(event.target.value as CostRange)}><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="all">All time</option></select></label></header>
      {isValidating && <p role="status" className="text-xs text-muted-foreground">Refreshing cost data…</p>}
      <WarningsBanner warnings={data.meta.warnings} />
      {costs.byModel.length === 0 ? <EmptyState icon={<CircleDollarSign />} title="No cost data in this range" description="Choose a wider range, or run an opencode session that reports model and token usage." /> : <><PricingBanner unpricedCount={unpriced} /><CostSummary costs={costs} /><CostModelTable models={costs.byModel} /><CacheEfficiency models={costs.byModel} /><CostCharts costs={costs} /></>}
    </div>
  );
}
