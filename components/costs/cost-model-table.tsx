import { Badge } from "@/components/ui/badge";
import { formatCost, formatTokens } from "@/lib/format";
import type { CostBreakdown } from "@/types/oc";

type ModelRow = CostBreakdown["byModel"][number];

function total(row: ModelRow): number {
  return row.tokens.input + row.tokens.output + row.tokens.reasoning + row.tokens.cacheRead + row.tokens.cacheWrite;
}

export function sortedCostModels(models: readonly ModelRow[]): ModelRow[] {
  return [...models].sort((left, right) => {
    if (left.cost.priced !== right.cost.priced) return left.cost.priced ? 1 : -1;
    return total(right) - total(left) || `${left.providerID}/${left.modelID}`.localeCompare(`${right.providerID}/${right.modelID}`);
  });
}

export function CostModelTable({ models }: { models: readonly ModelRow[] }) {
  const rows = sortedCostModels(models);
  return (
    <section aria-labelledby="model-costs-title" className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
      <header className="border-b border-border p-4"><h2 id="model-costs-title" className="font-semibold">Cost by model</h2><p className="mt-1 text-xs text-muted-foreground">Observed token volumes and costs computed only from your configured USD rates.</p></header>
      <div className="max-w-full overflow-x-auto"><table className="min-w-[1040px] w-full text-sm"><thead className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Provider / model</th><th className="px-3 py-2 text-right font-medium">Input</th><th className="px-3 py-2 text-right font-medium">Output</th><th className="px-3 py-2 text-right font-medium">Reasoning</th><th className="px-3 py-2 text-right font-medium">Cache read</th><th className="px-3 py-2 text-right font-medium">Cache write</th><th className="px-3 py-2 text-right font-medium">Total tokens</th><th className="px-3 py-2 text-right font-medium">Estimated cost</th></tr></thead><tbody className="divide-y divide-border">{rows.map((row) => <tr key={`${row.providerID}/${row.modelID}`}><td className="px-3 py-3"><p className="font-medium">{row.providerID} / {row.modelID}</p><div className="mt-1">{row.cost.priced ? <Badge variant="secondary">priced · USD</Badge> : <Badge variant="outline">not priced</Badge>}</div></td><td className="px-3 py-3 text-right font-mono">{formatTokens(row.tokens.input)}</td><td className="px-3 py-3 text-right font-mono">{formatTokens(row.tokens.output)}</td><td className="px-3 py-3 text-right font-mono">{formatTokens(row.tokens.reasoning)}</td><td className="px-3 py-3 text-right font-mono">{formatTokens(row.tokens.cacheRead)}</td><td className="px-3 py-3 text-right font-mono">{formatTokens(row.tokens.cacheWrite)}</td><td className="px-3 py-3 text-right font-mono">{formatTokens(total(row))}</td><td className={`px-3 py-3 text-right font-mono ${row.cost.priced ? "" : "text-muted-foreground"}`}>{formatCost(row.cost)}</td></tr>)}</tbody></table></div>
    </section>
  );
}
