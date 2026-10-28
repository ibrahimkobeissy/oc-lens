"use client";

import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

export function opencodeExportUrl(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/opencode-export`;
}

function fileNameFrom(disposition: string | null, fallback: string): string {
  return disposition?.match(/filename="([^"]+)"/)?.[1] ?? fallback;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {
    // Fall through to the status line.
  }
  return `The export failed (HTTP ${response.status}).`;
}

/**
 * Downloads one session as `opencode session import` input. Fetched rather than
 * linked so an unavailable export shows its reason here instead of downloading
 * an error body as if it were a transcript.
 */
export function SessionExportButton({ sessionId, isSubagent }: { sessionId: string; isSubagent: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(opencodeExportUrl(sessionId));
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileNameFrom(response.headers.get("content-disposition"), `opencode-session-${sessionId}.json`);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The export could not be downloaded.");
    } finally {
      setPending(false);
    }
  }

  const hint = isSubagent
    ? "Import with `opencode session import <file>`. This is a subagent session: import its parent session first."
    : "Import with `opencode session import <file>`. Subagent sessions are separate exports.";
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => void download()} title={hint}>
        {pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
        Export for opencode
      </Button>
      {error ? <p role="alert" className="max-w-sm text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
