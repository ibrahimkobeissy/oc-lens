"use client";

import { useEffect, useMemo, useState } from "react";
import { Bug, TriangleAlert, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { schemaVersion } from "@/lib/db/schema-guard";
import type { OcWarning } from "@/types/oc";

const STORAGE_KEY = "oc-lens:dismissed-warning-codes";
const ISSUES_URL = "https://github.com/ibrahimkobeissy/oc-lens/issues/new";

export interface AggregatedWarning extends OcWarning {
  messages: string[];
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
 * opens themselves, reviews on GitHub's own page, and submits (or doesn't).
 * Only warning codes/messages/counts and the pinned schema version go in; never
 * session content, file paths, or anything else read from the database.
 */
export function buildReportIssueUrl(warnings: readonly AggregatedWarning[], schemaVersionValue: string): string {
  const title = `Data shape mismatch: ${warnings.map((warning) => warning.code).join(", ")}`;
  const body = [
    "## Data shape mismatch",
    "",
    "Reported from oc-lens's data-caveats banner. This report contains only the warning codes, messages, and counts below — no session content, file paths, or other database contents.",
    "",
    `- **Schema version:** \`${schemaVersionValue}\``,
    "",
    "### Warnings",
    "",
    ...warnings.map((warning) => `- \`${warning.code}\`: ${warning.messages.join(" ")} (${warning.count})`),
    "",
    "<!-- Optional: if you can safely share the raw JSON row that triggered this (redact any file paths or content you don't want public), it helps a lot — see the project README for a read-only query to pull it. -->",
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

export function WarningsBanner({ warnings }: { warnings: readonly OcWarning[] }) {
  const aggregated = useMemo(() => aggregateWarnings(warnings), [warnings]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

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

  const reportUrl = buildReportIssueUrl(visible, schemaVersion);

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
        <Dialog>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="mt-3 gap-1.5">
              <Bug aria-hidden="true" className="size-3.5" />
              Report on GitHub
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Report this data shape?</DialogTitle>
              <DialogDescription>
                This opens a pre-filled GitHub issue in a new tab — nothing is sent automatically. Only the warning codes, messages, and counts below (plus the schema version) are included; no session content, file paths, or other database contents. Review and edit it on GitHub before submitting, or don&apos;t submit it at all.
              </DialogDescription>
            </DialogHeader>
            <ul className="list-disc space-y-1 rounded-md border border-border bg-muted/40 p-3 pl-7 text-sm">
              {visible.map((warning) => (
                <li key={warning.code}>
                  <span className="font-mono">{warning.code}</span>: {warning.messages.join(" ")} <span className="font-mono">({warning.count})</span>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button asChild>
                  <a href={reportUrl} target="_blank" rel="noopener noreferrer">Open GitHub issue</a>
                </Button>
              </DialogClose>
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
