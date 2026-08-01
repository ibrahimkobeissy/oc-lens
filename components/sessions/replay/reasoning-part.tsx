import { Brain, Clock3 } from "lucide-react";

import { registerReplayPartRenderer, type ReplayPartRendererProps } from "./part-registry";
import { formatDuration, formatNumber } from "@/lib/format";

export function reasoningDuration(timeStart: number | null, timeEnd: number | null): number | null {
  if (timeStart === null || timeEnd === null) return null;
  if (!Number.isFinite(timeStart) || !Number.isFinite(timeEnd) || timeEnd < timeStart) return null;
  return timeEnd - timeStart;
}

export function ReasoningPart({ part, turn }: ReplayPartRendererProps) {
  if (part.data.type !== "reasoning") return null;
  const duration = reasoningDuration(part.data.timeStart, part.data.timeEnd);
  const reasoningTokens = turn.tokens?.reasoning;
  const tokenLabel = reasoningTokens !== undefined && Number.isFinite(reasoningTokens) && reasoningTokens >= 0
    ? `${formatNumber(reasoningTokens)} turn reasoning tokens`
    : "Reasoning tokens unavailable";

  return (
    <details className="group rounded-lg border border-border bg-muted/20">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
        <Brain aria-hidden="true" className="size-4 text-primary" />
        <span className="font-medium text-foreground">Reasoning</span>
        <span className="ml-auto inline-flex items-center gap-1 font-mono text-xs"><Clock3 aria-hidden="true" className="size-3.5" />{formatDuration(duration)}</span>
        <span className="font-mono text-xs">{tokenLabel}</span>
      </summary>
      <div className="border-t border-border px-3 py-3">
        {part.data.text.length > 0
          ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{part.data.text}</p>
          : <p className="text-sm text-muted-foreground">No reasoning text recorded.</p>}
      </div>
    </details>
  );
}

registerReplayPartRenderer("reasoning", ReasoningPart);
