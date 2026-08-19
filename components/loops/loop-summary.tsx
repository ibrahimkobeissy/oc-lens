import { formatCost, formatNumber } from "@/lib/format";
import type { LoopAnalysis, LoopKind } from "@/types/oc";

const KIND_LABEL: Record<LoopKind, string> = {
  "error-retry": "Error retries",
  "redundant-repeat": "Redundant repeats",
  oscillation: "Oscillations",
};

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * The headline tiles.
 *
 * The cost tile is deliberately *not* called "wasted spend". opencode records
 * cost per message, never per tool call, so this is the cost of the turns that
 * contained the repeats — an upper bound dominated by context tokens the turn
 * would have paid anyway. Calling it savings would overstate it by a lot.
 */
export function LoopSummary({ analysis }: { analysis: LoopAnalysis }) {
  const byKind = new Map<LoopKind, number>();
  for (const incident of analysis.incidents) {
    byKind.set(incident.kind, (byKind.get(incident.kind) ?? 0) + 1);
  }

  return (
    <section aria-label="Loop summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        label="Repeated turns cost"
        value={formatCost(analysis.totalRepeatedTurnCost)}
        hint={
          analysis.totalRepeatedTurnCost.priced
            ? "What the turns holding these repeats cost — not what you would save"
            : "Enter model prices in Settings to see this"
        }
      />
      <Tile
        label="Redundant runs"
        value={formatNumber(analysis.totalWastedCalls)}
        hint="Runs after the first of each repeated call"
      />
      <Tile label="Incidents" value={formatNumber(analysis.incidents.length)} hint="Distinct loops detected" />
      <Tile
        label="Most common"
        value={
          analysis.incidents.length === 0
            ? "—"
            : KIND_LABEL[
                [...byKind.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "redundant-repeat"
              ]
        }
        hint={
          analysis.incidents.length === 0
            ? "Nothing detected in this range"
            : [...byKind.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([kind, count]) => `${KIND_LABEL[kind]}: ${count}`)
                .join(" · ")
        }
      />
    </section>
  );
}
