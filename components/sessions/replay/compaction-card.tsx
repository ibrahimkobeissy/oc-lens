import { Scissors } from "lucide-react";

import { registerReplayPartRenderer, type ReplayPartRendererProps } from "./part-registry";

/**
 * Renders only the three fields ever actually observed on a real `compaction`
 * part (data-model §5, confirmed live 2026-08-02) — opencode has no
 * pre-compaction token count, so unlike cc-lens's Claude-Code equivalent this
 * never shows one.
 */
export function CompactionCard({ part }: ReplayPartRendererProps) {
  if (part.data.type !== "compaction") return null;
  const { auto, overflow, tailStartId } = part.data;

  return (
    <details className="group rounded-lg border border-warning/40 bg-warning/5">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 text-sm text-warning">
        <Scissors aria-hidden="true" className="size-4" />
        <span className="font-medium">Context compaction</span>
        <span className="ml-auto font-mono text-xs">{auto ? "automatic" : "manual"}{overflow ? " · context overflow" : ""}</span>
      </summary>
      <div className="border-t border-warning/30 px-3 py-3 text-xs text-muted-foreground">
        <p>The context before this point was compacted; replay continues from the retained tail starting at message <code className="font-mono text-foreground">{tailStartId}</code>.</p>
      </div>
    </details>
  );
}

registerReplayPartRenderer("compaction", CompactionCard);
