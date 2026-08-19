import { Clock3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatCost, formatDuration } from "@/lib/format";
import type { ReplayTurn } from "@/types/oc";

const usdFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const COST_COMPARISON_EPSILON = 1e-9;

/** Sum the finest-grained provider cost signals recorded for this turn. */
export function providerReportedTurnCost(turn: Pick<ReplayTurn, "parts">): number | null {
  let total = 0;
  let observed = false;

  for (const part of turn.parts) {
    if (part.data.type !== "step-finish") continue;
    const cost = part.data.cost;
    if (cost === null || !Number.isFinite(cost) || cost < 0) continue;
    total += cost;
    observed = true;
  }

  return observed ? total : null;
}

export function turnCostsDisagree(turn: Pick<ReplayTurn, "cost" | "parts">): boolean {
  const providerCost = providerReportedTurnCost(turn);
  return turn.cost.priced
    && providerCost !== null
    && Math.abs(turn.cost.amount - providerCost) > COST_COMPARISON_EPSILON;
}

function formatProviderCost(cost: number | null): string {
  return cost === null || cost <= 0 ? "not reported" : usdFormatter.format(cost);
}

export function TurnMetrics({ turn }: { turn: ReplayTurn }) {
  const providerCost = providerReportedTurnCost(turn);
  const disagree = turnCostsDisagree(turn);

  return <dl aria-label="Assistant turn metrics" className="grid gap-2 text-xs sm:grid-cols-3">
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <dt className="inline-flex items-center gap-1 text-muted-foreground"><Clock3 aria-hidden="true" className="size-3.5" />Duration</dt>
      <dd className="mt-1 font-mono font-medium tabular-nums">{formatDuration(turn.durationMs)}</dd>
    </div>
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <dt className="text-muted-foreground">Your configured cost</dt>
      <dd className="mt-1 font-mono font-medium tabular-nums">{formatCost(turn.cost)}</dd>
    </div>
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <dt className="flex flex-wrap items-center gap-1 text-muted-foreground">
        Provider-reported cost
        {disagree ? <Badge variant="outline">Different</Badge> : null}
      </dt>
      <dd className="mt-1 font-mono font-medium tabular-nums">{formatProviderCost(providerCost)}</dd>
    </div>
  </dl>;
}
