"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { DateRange } from "react-day-picker";
import { CalendarDays, CheckCircle2, Download, FileArchive, FileJson2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Onboarding } from "@/components/states/onboarding";
import { SchemaMismatch } from "@/components/states/schema-mismatch";
import { useOc } from "@/hooks/use-oc";
import { schemaVersion } from "@/lib/db/schema-guard";
import type { ExportManifestCounts, ExportResponse } from "@/types/oc";
import {
  createExportZip,
  downloadName,
  EXPORT_SCOPES,
  exportUrl,
  previewText,
  SCOPE_DETAILS,
  type ExportScope,
} from "./export-utils";

const subscribeBrowserSettings = () => () => undefined;

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function rangeLabel(range: DateRange | undefined): string {
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
  if (!range?.from) return "All dates";
  if (!range.to) return `${formatter.format(range.from)} – …`;
  return `${formatter.format(range.from)} – ${formatter.format(range.to)}`;
}

function isExportResponse(value: unknown): value is { data: ExportResponse } {
  if (typeof value !== "object" || value === null || !("data" in value)) return false;
  const data = (value as { data?: unknown }).data;
  return typeof data === "object" && data !== null && "schemaVersion" in data && "counts" in data;
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

export function ScopeSelector({ selected, onToggle }: { selected: readonly ExportScope[]; onToggle: (scope: ExportScope) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-foreground">Datasets</legend>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {EXPORT_SCOPES.map((scope) => {
          const detail = SCOPE_DETAILS[scope];
          return (
            <label key={scope} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/50 has-checked:border-primary has-checked:bg-primary/5">
              <input
                className="mt-0.5 size-4 accent-primary"
                type="checkbox"
                checked={selected.includes(scope)}
                onChange={() => onToggle(scope)}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{detail.label}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{detail.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function PreviewGrid({ scopes, counts }: { scopes: readonly ExportScope[]; counts: ExportManifestCounts }) {
  return (
    <div aria-label="Export preview" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {scopes.map((scope) => (
        <div key={scope} className="rounded-lg border border-border bg-background/40 p-3">
          <p className="text-sm font-medium text-foreground">{SCOPE_DETAILS[scope].label}</p>
          <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">{previewText(scope, counts)}</p>
        </div>
      ))}
    </div>
  );
}

export function ExportPanel() {
  const [selected, setSelected] = useState<ExportScope[]>([...EXPORT_SCOPES]);
  const [range, setRange] = useState<DateRange>();
  const [format, setFormat] = useState<"json" | "zip" | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<string | null>(null);
  const timeZone = useSyncExternalStore(subscribeBrowserSettings, browserTimeZone, () => "UTC");
  const previewRoute = useMemo(
    () => exportUrl(selected, range ?? {}, timeZone, true) as `/api/export?${string}`,
    [range, selected, timeZone],
  );
  const preview = useOc(previewRoute, { enabled: selected.length > 0, polling: false, keepPreviousData: true });

  const toggleScope = (scope: ExportScope) => {
    setSelected((current) => current.includes(scope)
      ? current.filter((item) => item !== scope)
      : EXPORT_SCOPES.filter((item) => current.includes(item) || item === scope));
  };

  const handleDownload = async (nextFormat: "json" | "zip") => {
    if (selected.length === 0) return;
    setFormat(nextFormat);
    setDownloadError(null);
    setDownloaded(null);
    try {
      const response = await fetch(exportUrl(selected, range ?? {}, timeZone));
      if (!response.ok) throw new Error(`Export failed (${response.status}).`);

      if (nextFormat === "json") {
        const blob = await response.blob();
        const name = downloadName("json");
        downloadBlob(blob, name);
        setDownloaded(name);
      } else {
        await yieldToBrowser();
        const payload: unknown = await response.json();
        if (!isExportResponse(payload)) throw new Error("The export response was not valid.");
        await yieldToBrowser();
        const blob = await createExportZip(payload.data, selected);
        const name = downloadName("zip", payload.data.generatedAt);
        downloadBlob(blob, name);
        setDownloaded(name);
      }
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "The export could not be downloaded.");
    } finally {
      setFormat(null);
    }
  };

  if (preview.error?.isDatabaseNotFound) return <Onboarding />;
  if (preview.error?.isSchemaMismatch) return <SchemaMismatch schemaVersion={schemaVersion} message={preview.error.message} />;

  const counts = preview.data?.data.counts;
  const nothingInRange = counts !== undefined && Object.values(counts).every((count) => count === 0);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Read-only portability</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Export</h1>
        <p className="mt-1 text-sm text-muted-foreground">Download selected local analytics as streamed JSON or a structured ZIP bundle.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Choose export contents</CardTitle>
          <CardDescription>Select datasets and an optional inclusive date range. The database is never modified.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <ScopeSelector selected={selected} onToggle={toggleScope} />
          <div className="flex flex-wrap items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline"><CalendarDays aria-hidden="true" />{rangeLabel(range)}</Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar mode="range" selected={range} onSelect={setRange} numberOfMonths={1} />
              </PopoverContent>
            </Popover>
            {range?.from ? <Button variant="ghost" onClick={() => setRange(undefined)}>Clear dates</Button> : null}
            <span className="text-xs text-muted-foreground">{timeZone}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live preview</CardTitle>
          <CardDescription>Counts refresh whenever the selected datasets or date range changes.</CardDescription>
        </CardHeader>
        <CardContent>
          {selected.length === 0 ? (
            <EmptyState title="No datasets selected" description="Select at least one dataset to preview and download an export." />
          ) : preview.isLoading && !preview.data ? (
            <div aria-label="Loading export preview" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="status">
              {selected.map((scope) => <Skeleton key={scope} className="h-20 rounded-lg" />)}
            </div>
          ) : preview.error ? (
            <ErrorState message="The export preview is temporarily unavailable." onRetry={() => void preview.mutate()} />
          ) : nothingInRange ? (
            <EmptyState title="Nothing to export in this range" description="Choose a wider date range or export all dates." />
          ) : counts ? (
            <PreviewGrid scopes={selected} counts={counts} />
          ) : (
            <EmptyState title="No preview available" description="The export preview has not returned yet." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Download</CardTitle>
          <CardDescription>JSON preserves the streamed API response. ZIP contains one file per selected dataset plus manifest.json.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button disabled={selected.length === 0 || format !== null} onClick={() => void handleDownload("json")}>
              <FileJson2 aria-hidden="true" />{format === "json" ? "Preparing JSON…" : "Download JSON"}
            </Button>
            <Button variant="outline" disabled={selected.length === 0 || format !== null} onClick={() => void handleDownload("zip")}>
              <FileArchive aria-hidden="true" />{format === "zip" ? "Building ZIP…" : "Download ZIP"}
            </Button>
          </div>
          {downloadError ? (
            <Alert variant="destructive"><Download aria-hidden="true" /><AlertTitle>Download failed</AlertTitle><AlertDescription>{downloadError}</AlertDescription></Alert>
          ) : null}
          {downloaded ? (
            <Alert><CheckCircle2 aria-hidden="true" /><AlertTitle>Export downloaded</AlertTitle><AlertDescription>{downloaded}</AlertDescription></Alert>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
