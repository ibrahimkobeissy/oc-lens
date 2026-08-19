"use client";

import { useMemo, useState } from "react";
import { Repeat } from "lucide-react";

import { LoopSummary } from "@/components/loops/loop-summary";
import { LoopCoverageNote } from "@/components/loops/loop-coverage-note";
import { LoopIncidentTable } from "@/components/loops/loop-incident-table";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Onboarding } from "@/components/states/onboarding";
import { SchemaMismatch } from "@/components/states/schema-mismatch";
import { WarningsBanner } from "@/components/states/warnings-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { useOc } from "@/hooks/use-oc";
import { schemaVersion } from "@/lib/db/schema-guard";
import { DEFAULT_UI_MIN_REPEATS, MIN_REPEAT_CHOICES } from "@/lib/loops";

type Range = "7d" | "30d" | "90d" | "all";

export default function LoopsPage() {
  const [range, setRange] = useState<Range>("30d");
  const [minRepeats, setMinRepeats] = useState<number>(DEFAULT_UI_MIN_REPEATS);
  const route = useMemo(() => `/api/loops?range=${range}&minRepeats=${minRepeats}` as const, [range, minRepeats]);
  const { data, error, isLoading, mutate } = useOc(route);

  if (error?.isDatabaseNotFound) return <Onboarding />;
  if (error?.isSchemaMismatch) return <SchemaMismatch schemaVersion={schemaVersion} message={error.message} />;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Loops</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Where the agent repeated itself — retrying failures, re-reading what it already knew, or undoing its own
            edits.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium">
            Repeats
            <select
              aria-label="Minimum repeats"
              className="ml-2 h-9 rounded-md border border-input bg-background px-3"
              value={minRepeats}
              onChange={(event) => setMinRepeats(Number(event.target.value))}
            >
              {MIN_REPEAT_CHOICES.map((value) => (
                <option key={value} value={value}>
                  {value}+
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Range
            <select
              aria-label="Loops range"
              className="ml-2 h-9 rounded-md border border-input bg-background px-3"
              value={range}
              onChange={(event) => setRange(event.target.value as Range)}
            >
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="90d">90 days</option>
              <option value="all">All time</option>
            </select>
          </label>
        </div>
      </header>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
      )}
      {error && !isLoading && <ErrorState message={error.message} onRetry={() => void mutate()} />}
      {data && <WarningsBanner warnings={data.meta.warnings} />}

      {data && (
        <>
          <LoopSummary analysis={data.data} />
          <LoopCoverageNote coverage={data.data.coverage} />
          {data.data.incidents.length === 0 ? (
            <EmptyState
              icon={<Repeat />}
              title="No loops detected in this range"
              description={
                [
                  `Nothing ran ${minRepeats} or more times in this range.`,
                  data.data.coverage.unsignaturable > 0
                    ? "Some calls recorded no input and could not be compared — see the coverage note above."
                    : "Calls to different targets, and a call repeated twice far apart, are ordinary work and are not counted.",
                  minRepeats > MIN_REPEAT_CHOICES[0] ? "Lower the repeats threshold to widen the search." : "",
                ]
                  .filter(Boolean)
                  .join(" ")
              }
            />
          ) : (
            <LoopIncidentTable incidents={data.data.incidents} />
          )}
        </>
      )}
    </div>
  );
}
