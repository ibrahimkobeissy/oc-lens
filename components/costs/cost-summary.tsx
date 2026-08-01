import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCost } from "@/lib/format";
import type { CostBreakdown } from "@/types/oc";

function providerCost(value: number): string {
  if (value === 0) return "not reported";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function CostSummary({ costs }: { costs: CostBreakdown }) {
  const unpriced = costs.byModel.filter((row) => !row.cost.priced).length;
  return (
    <section aria-label="Cost totals" className="grid gap-3 sm:grid-cols-2">
      <Card className="gap-2 py-4"><CardHeader className="px-4"><CardDescription>Estimated cost</CardDescription><CardTitle className="font-mono text-2xl">{formatCost(costs.totalCost)}</CardTitle></CardHeader><CardContent className="px-4 text-xs text-muted-foreground">{unpriced > 0 ? `Configured models only; ${unpriced} model${unpriced === 1 ? " remains" : "s remain"} unpriced.` : "Computed from all observed models using your rates."}</CardContent></Card>
      <Card className="gap-2 py-4"><CardHeader className="px-4"><CardDescription>Provider-reported comparison</CardDescription><CardTitle className="font-mono text-2xl">{providerCost(costs.storedCostComparison)}</CardTitle></CardHeader><CardContent className="px-4 text-xs text-muted-foreground">Stored separately from oc-lens estimates; never used as your configured cost.</CardContent></Card>
    </section>
  );
}
