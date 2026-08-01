import { EmptyState } from "@/components/states/empty-state";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { FeatureAdoption, FeatureAdoptionRow } from "@/types/oc";

const FEATURES: Array<{ key: keyof FeatureAdoption; label: string; evidence: string }> = [
  { key: "subagents", label: "Subagents", evidence: "Sessions with at least one task tool call or a non-null parent_id" },
  { key: "mcp", label: "MCP", evidence: "Sessions with at least one tool call resolved against a configured MCP server name" },
  { key: "webfetch", label: "Web fetch", evidence: "Sessions with at least one webfetch tool call" },
  { key: "planMode", label: "Plan mode", evidence: "Sessions with at least one message whose data.mode records plan mode" },
  { key: "reasoning", label: "Reasoning", evidence: "Sessions with at least one reasoning part" },
  { key: "todos", label: "Todos", evidence: "Sessions with at least one todo row" },
  { key: "skills", label: "Skills", evidence: "Sessions with at least one skill tool call" },
];

export function adoptionRows(adoption: FeatureAdoption): Array<{ key: keyof FeatureAdoption; label: string; evidence: string; value: FeatureAdoptionRow }> {
  return FEATURES.map((feature) => ({ ...feature, value: adoption[feature.key] }));
}

export function FeatureAdoptionTable({ adoption }: { adoption: FeatureAdoption }) {
  const rows = adoptionRows(adoption);
  if (rows.every((row) => row.value.sessionCount === 0)) return <EmptyState title="No feature adoption yet" description="Feature usage appears after qualifying sessions are recorded." />;
  return <TooltipProvider><section className="overflow-hidden rounded-lg border border-border bg-card" aria-labelledby="adoption-heading"><header className="border-b border-border p-4"><h2 id="adoption-heading" className="font-semibold">Feature adoption</h2><p className="mt-1 text-xs text-muted-foreground">Sessions using evidence-backed opencode features. Web search and inferred git commits are intentionally omitted.</p></header><Table><TableHeader><TableRow><TableHead>Feature</TableHead><TableHead>Evidence</TableHead><TableHead className="text-right">Sessions</TableHead><TableHead className="min-w-44">Adoption (% of sessions in range)</TableHead><TableHead>First used</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.key}><TableCell className="font-medium">{row.label}</TableCell><TableCell><Tooltip><TooltipTrigger asChild><button type="button" className="cursor-help text-left text-muted-foreground underline decoration-dotted underline-offset-2" aria-label={`${row.label} evidence`} title={row.evidence}>How detected</button></TooltipTrigger><TooltipContent><p>{row.evidence}</p></TooltipContent></Tooltip></TableCell><TableCell className="text-right font-mono">{row.value.sessionCount}</TableCell><TableCell><div className="flex items-center gap-2"><Progress value={row.value.pct * 100} /><span className="w-14 text-right font-mono text-xs">{(row.value.pct * 100).toFixed(1)}%</span></div></TableCell><TableCell>{row.value.firstUsed === null ? "—" : <time suppressHydrationWarning dateTime={new Date(row.value.firstUsed).toISOString()}>{new Date(row.value.firstUsed).toLocaleDateString()}</time>}</TableCell></TableRow>)}</TableBody></Table></section></TooltipProvider>;
}
