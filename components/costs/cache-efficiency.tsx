import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatTokens } from "@/lib/format";
import type { CostBreakdown } from "@/types/oc";

export function cacheTotals(models: CostBreakdown["byModel"]): { read: number; write: number; all: number } {
  return models.reduce((sum, model) => ({
    read: sum.read + model.tokens.cacheRead,
    write: sum.write + model.tokens.cacheWrite,
    all: sum.all + model.tokens.input + model.tokens.output + model.tokens.reasoning + model.tokens.cacheRead + model.tokens.cacheWrite,
  }), { read: 0, write: 0, all: 0 });
}

export function CacheEfficiency({ models }: { models: CostBreakdown["byModel"] }) {
  const cache = cacheTotals(models);
  if (cache.read + cache.write === 0) {
    return <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">Your provider does not report cache usage for this range.</p>;
  }
  const percentage = cache.all === 0 ? 0 : ((cache.read + cache.write) / cache.all) * 100;
  return (
    <Card className="gap-3 py-4"><CardHeader className="px-4"><CardTitle>Cache efficiency</CardTitle><CardDescription>Share of observed tokens reported as cache reads or writes.</CardDescription></CardHeader><CardContent className="space-y-3 px-4"><div className="flex items-end justify-between gap-4"><p className="font-mono text-2xl font-semibold">{percentage.toFixed(1)}%</p><p className="text-right text-xs text-muted-foreground">Read {formatTokens(cache.read)} · Write {formatTokens(cache.write)}</p></div><Progress value={percentage} aria-label={`${percentage.toFixed(1)} percent cache tokens`} /></CardContent></Card>
  );
}
