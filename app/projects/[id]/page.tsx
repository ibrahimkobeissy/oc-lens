"use client";

import { useSyncExternalStore } from "react";
import { useParams } from "next/navigation";

import { ProjectDetail } from "@/components/projects/project-detail";
import { ErrorState } from "@/components/states/error-state";
import { Onboarding } from "@/components/states/onboarding";
import { SchemaMismatch } from "@/components/states/schema-mismatch";
import { WarningsBanner } from "@/components/states/warnings-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { useOc } from "@/hooks/use-oc";
import { schemaVersion } from "@/lib/db/schema-guard";

const subscribeBrowserSettings = () => () => undefined;

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const timeZone = useSyncExternalStore(subscribeBrowserSettings, browserTimeZone, () => "UTC");
  const result = useOc(`/api/projects/${encodeURIComponent(id)}?tz=${encodeURIComponent(timeZone)}`, { polling: false });

  if (result.error?.isDatabaseNotFound) return <Onboarding />;
  if (result.error?.isSchemaMismatch) return <SchemaMismatch schemaVersion={schemaVersion} message={result.error.message} />;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {result.isLoading ? <div role="status" aria-label="Loading project detail" className="space-y-5"><Skeleton className="h-5 w-48" /><Skeleton className="h-24 w-full" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-24" />)}</div><Skeleton className="h-80 w-full" /><Skeleton className="h-72 w-full" /></div> : null}
      {result.error ? <ErrorState title="Project unavailable" message={result.error.message} onRetry={() => void result.mutate()} /> : null}
      {result.data ? <WarningsBanner warnings={result.data.meta.warnings} /> : null}
      {!result.isLoading && !result.error && result.data ? <ProjectDetail project={result.data.data} timeZone={timeZone} /> : null}
    </div>
  );
}
