"use client";

import { Settings } from "lucide-react";

import { HealthPanel } from "@/components/settings/health-panel";
import { SettingsContent } from "@/components/settings/settings-content";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { WarningsBanner } from "@/components/states/warnings-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { useOc } from "@/hooks/use-oc";

function SettingsSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading settings">
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}

export default function SettingsPage() {
  const { data, error, isLoading, mutate } = useOc("/api/settings", { polling: false });

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Settings aria-hidden="true" className="size-6" />Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Local environment, safe configuration, pricing, and optional server health.</p>
      </div>

      {isLoading ? <SettingsSkeleton /> : null}
      {error ? <ErrorState message={error.message} onRetry={() => void mutate()} /> : null}
      {data ? <WarningsBanner warnings={data.meta.warnings} /> : null}
      {data ? <SettingsContent settings={data.data} /> : null}
      {!isLoading && !error && !data ? (
        <EmptyState title="No settings data" description="The settings response is not available yet." />
      ) : null}

      <HealthPanel />
    </div>
  );
}
