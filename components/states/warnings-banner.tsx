"use client";

import { useEffect, useMemo, useState } from "react";
import { TriangleAlert, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { OcWarning } from "@/types/oc";

const STORAGE_KEY = "oc-lens:dismissed-warning-codes";

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
