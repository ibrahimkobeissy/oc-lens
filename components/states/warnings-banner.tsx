"use client";

import { useEffect, useMemo, useState } from "react";
import { Bug, TriangleAlert, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { schemaVersion } from "@/lib/db/schema-guard";
import { ocFetcher } from "@/lib/swr";
import type { OcWarning } from "@/types/oc";

const STORAGE_KEY = "oc-lens:dismissed-warning-codes";
const ISSUES_URL = "https://github.com/ibrahimkobeissy/oc-lens/issues/new";

export interface AggregatedWarning extends OcWarning {
  messages: string[];
}

export interface WarningSample {
  code: string;
  found: boolean;
  sourceId: string | null;
  raw: string | null;
  truncated: boolean;
}

/** Aggregates repeated warning codes without losing distinct explanations. */
export function aggregateWarnings(warnings: readonly OcWarning[]): AggregatedWarning[] {
  const byCode = new Map<string, AggregatedWarning>();
  for (const warning of warnings) {
    const existing = byCode.get(warning.code);
    if (existing) {
      existing.count += warning.count;
      if (!existing.messages.includes(warning.message)) {
        existing.messages.push(warning.message);
      }
    } else {
      byCode.set(warning.code, { ...warning, messages: [warning.message] });
    }
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Builds a pre-filled GitHub "new issue" URL from the currently visible warnings.
 * Nothing is sent anywhere by this function — it only shapes a URL that the user
 * opens themselves, reviews on GitHub's own page, and submits (or doesn't). When a
 * real raw sample was found for a warning's code, it's embedded verbatim: that's
 * actual data from the user's own database, not a synthetic example, so the caller
 * must make that unmistakable to the user before they ever reach this URL.
 */
export function buildReportIssueUrl(
  warnings: readonly AggregatedWarning[],
  schemaVersionValue: string,
  samples: Readonly<Record<string, WarningSample>> = {},
): string {
  const title = `Data shape mismatch: ${warnings.map((warning) => warning.code).join(", ")}`;
  const sections = warnings.map((warning) => {
    const sample = samples[warning.code];
    const heading = `- \`${warning.code}\`: ${warning.messages.join(" ")} (${warning.count})`;
    if (!sample || !sample.found || sample.raw === null) {
      return `${heading}\n  - No raw example included (none was found, or the field was legitimately empty).`;
    }
    const truncatedNote = sample.truncated ? "\n  (truncated)" : "";
    return `${heading}\n  - Real example from this database (\`${sample.sourceId}\`), included automatically — remove it below if you'd rather not share it:\n\n\`\`\`json\n${sample.raw}\n\`\`\`${truncatedNote}`;
  });
  const body = [
    "## Data shape mismatch",
    "",
    "Reported from oc-lens's data-caveats banner.",
    "",
    `- **Schema version:** \`${schemaVersionValue}\``,
    "",
    "### Warnings",
    "",
    ...sections,
    "",
    "<!-- Any raw examples above came directly from this reporter's local database. Delete anything above you don't want to share before submitting — it's entirely up to you. -->",
  ].join("\n");
  const params = new URLSearchParams({ title, body, labels: "data-shape" });
  return `${ISSUES_URL}?${params.toString()}`;
}

function readDismissed(): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

async function fetchSample(code: string): Promise<WarningSample> {
  try {
    const envelope = await ocFetcher<WarningSample>(`/api/warnings/sample?code=${encodeURIComponent(code)}`);
    return envelope.data;
  } catch {
    return { code, found: false, sourceId: null, raw: null, truncated: false };
  }
}

export function WarningsBanner({ warnings }: { warnings: readonly OcWarning[] }) {
  const aggregated = useMemo(() => aggregateWarnings(warnings), [warnings]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [reportOpen, setReportOpen] = useState(false);
  const [samples, setSamples] = useState<Record<string, WarningSample>>({});
  const [samplesLoading, setSamplesLoading] = useState(false);

  useEffect(() => {
    // Defer the browser-only storage read until after hydration without doing a
    // synchronous state transition inside the effect itself.
    const timer = window.setTimeout(() => setDismissed(readDismissed()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const visible = aggregated.filter((warning) => !dismissed.has(warning.code));
  if (visible.length === 0) return null;

  function dismissVisible(): void {
    const next = new Set(dismissed);
    for (const warning of visible) next.add(warning.code);
    setDismissed(next);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  }

  function handleReportOpenChange(next: boolean): void {
    setReportOpen(next);
    if (!next) return;
    const missing = visible.map((warning) => warning.code).filter((code) => !(code in samples));
    if (missing.length === 0) return;
    setSamplesLoading(true);
    void Promise.all(missing.map((code) => fetchSample(code))).then((results) => {
      setSamples((current) => {
        const next = { ...current };
        for (const result of results) next[result.code] = result;
        return next;
      });
      setSamplesLoading(false);
    });
  }

  const allLoaded = visible.every((warning) => warning.code in samples);
  const reportUrl = allLoaded ? buildReportIssueUrl(visible, schemaVersion, samples) : null;

  return (
    <Alert className="border-warning/40 bg-warning/5 pr-12 text-foreground">
      <TriangleAlert aria-hidden="true" className="text-warning" />
      <AlertTitle>Data caveats</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-1 pl-4">
          {visible.map((warning) => (
            <li key={warning.code}>
              {warning.messages.join(" ")} <span className="font-mono">({warning.count})</span>
            </li>
          ))}
        </ul>
        <Dialog open={reportOpen} onOpenChange={handleReportOpenChange}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="mt-3 gap-1.5">
              <Bug aria-hidden="true" className="size-3.5" />
              Report on GitHub
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Report this data shape?</DialogTitle>
              <DialogDescription>
                This opens a pre-filled GitHub issue in a new tab — nothing is sent automatically. Where a real example could be found, it&apos;s pulled directly from your local database and included below, since it may contain file paths, code, or other content from your machine. Review it and delete anything you don&apos;t want to share before submitting on GitHub, or don&apos;t submit it at all.
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
              {visible.map((warning) => {
                const sample = samples[warning.code];
                return (
                  <li key={warning.code} className="space-y-1.5">
                    <p>
                      <span className="font-mono">{warning.code}</span>: {warning.messages.join(" ")} <span className="font-mono">({warning.count})</span>
                    </p>
                    {!sample && samplesLoading && <p className="text-xs text-muted-foreground">Looking for a real example…</p>}
                    {sample && !sample.found && <p className="text-xs text-muted-foreground">No raw example found for this one.</p>}
                    {sample?.found && sample.raw && (
                      <pre className="max-h-40 overflow-auto rounded border border-border bg-background p-2 text-xs">{sample.raw}</pre>
                    )}
                  </li>
                );
              })}
            </ul>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              {reportUrl ? (
                <DialogClose asChild>
                  <Button asChild>
                    <a href={reportUrl} target="_blank" rel="noopener noreferrer">Open GitHub issue</a>
                  </Button>
                </DialogClose>
              ) : (
                <Button type="button" disabled>Preparing…</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AlertDescription>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute right-2 top-2"
        aria-label="Dismiss data warnings for this browser session"
        onClick={dismissVisible}
      >
        <X aria-hidden="true" />
      </Button>
    </Alert>
  );
}
