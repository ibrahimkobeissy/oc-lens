import { Activity } from "lucide-react";

import { registerReplayPartRenderer, type ReplayPartRendererProps } from "./part-registry";
import { cn } from "@/lib/utils";

/**
 * An opencode 2.x lifecycle record (data-model §8) — an idle marker, a system
 * context update, an agent/model switch, a user-run shell command. These are
 * not turns, so they render as a quiet one-line marker; anything with a body
 * (system text, shell output, an idle error) expands on demand.
 */
export function SessionEventCard({ part }: ReplayPartRendererProps) {
  if (part.data.type !== "session-event") return null;
  const { kind, rawKind, summary, detail, outcome, exitCode } = part.data;
  const failed = outcome === "failed" || (exitCode !== null && exitCode !== 0);
  const header = (
    <>
      <Activity aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{summary}</span>
      <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wide">
        {kind === "unknown" ? `unrecognised · ${rawKind || "unknown"}` : rawKind}
        {exitCode !== null ? ` · exit ${exitCode}` : ""}
      </span>
    </>
  );
  const tone = cn("flex items-center gap-2 px-3 py-1.5 text-xs", failed ? "text-warning" : "text-muted-foreground");

  if (detail === null || detail.trim().length === 0) {
    return <div role="note" className={cn("rounded-md border border-dashed border-border", tone)}>{header}</div>;
  }
  return (
    <details className="rounded-md border border-dashed border-border">
      <summary className={cn("cursor-pointer list-none", tone)}>{header}</summary>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-dashed border-border px-3 py-2 font-mono text-xs text-muted-foreground">{detail}</pre>
    </details>
  );
}

registerReplayPartRenderer("session-event", SessionEventCard);
