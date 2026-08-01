"use client";

import { Database, FolderArchive } from "lucide-react";

import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOc } from "@/hooks/use-oc";
import type { StorageBreakdown } from "@/types/oc";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1_024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1_024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && value >= 1_024; index += 1) {
    value /= 1_024;
    unit = units[index]!;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function StorageContent({ storage }: { storage: StorageBreakdown }) {
  const rows = [
    { label: "opencode.db", detail: "Main history database", bytes: storage.dbBytes },
    { label: "opencode.db-wal", detail: "SQLite write-ahead log", bytes: storage.walBytes },
    { label: "log/", detail: "opencode logs", bytes: storage.logBytes },
    { label: "repos/", detail: "Repository metadata", bytes: storage.reposBytes },
  ];

  if (storage.totalBytes === 0 && storage.logBytes === null && storage.reposBytes === null) {
    return (
      <EmptyState
        icon={<FolderArchive aria-hidden="true" />}
        title="No storage footprint available"
        description="The database is empty and the optional log and repository directories are not present."
      />
    );
  }

  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="min-w-0 rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <dt className="truncate font-mono text-sm font-medium text-foreground">{row.label}</dt>
                <p className="mt-1 text-xs text-muted-foreground">{row.detail}</p>
              </div>
              <dd className="shrink-0 font-mono text-sm tabular-nums text-foreground">{formatBytes(row.bytes)}</dd>
            </div>
            {row.bytes !== null && storage.totalBytes > 0 ? (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (row.bytes / storage.totalBytes) * 100)}%` }} />
              </div>
            ) : null}
          </div>
        ))}
      </dl>
      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <span className="text-sm font-medium text-muted-foreground">Total footprint</span>
        <strong className="font-mono text-lg tabular-nums text-foreground">{formatBytes(storage.totalBytes)}</strong>
      </div>
    </div>
  );
}

export function StoragePanel() {
  const { data, error, isLoading, mutate } = useOc("/api/storage", { polling: false });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Database aria-hidden="true" className="size-4" />Storage footprint</CardTitle>
        <CardDescription>Read-only disk usage for opencode data.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div aria-label="Loading storage footprint" className="grid gap-3 sm:grid-cols-2" role="status">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-20 rounded-lg" />)}
          </div>
        ) : error ? (
          <ErrorState message="Storage footprint is temporarily unavailable." onRetry={() => void mutate()} />
        ) : data ? (
          <StorageContent storage={data.data} />
        ) : (
          <EmptyState title="No storage data" description="No storage response is available yet." />
        )}
      </CardContent>
    </Card>
  );
}

export { formatBytes, StorageContent };
