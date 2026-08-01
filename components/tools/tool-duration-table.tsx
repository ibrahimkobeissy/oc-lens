import { EmptyState } from "@/components/states/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, formatNumber } from "@/lib/format";
import { toolDisplayName } from "@/lib/tools";
import type { ToolSummary } from "@/types/oc";

export function ToolDurationTable({ tools }: { tools: ToolSummary[] }) {
  const rows = [...tools].sort((left, right) => right.totalCalls - left.totalCalls || left.tool.localeCompare(right.tool));
  if (rows.length === 0) return <EmptyState title="No timing data" description="Tool durations will appear after timed calls are recorded." />;
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="border-b border-border p-4"><h2 className="font-semibold">Tool durations</h2><p className="mt-1 text-xs text-muted-foreground">Median and 95th-percentile completed-call duration.</p></header>
      <Table>
        <TableHeader><TableRow><TableHead>Tool</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">p50</TableHead><TableHead className="text-right">p95</TableHead></TableRow></TableHeader>
        <TableBody>{rows.map((tool) => <TableRow key={tool.tool}>
          <TableCell className="font-medium">{toolDisplayName(tool.tool)}</TableCell><TableCell className="capitalize text-muted-foreground">{tool.category}</TableCell><TableCell className="text-right font-mono">{formatNumber(tool.totalCalls)}</TableCell><TableCell className="text-right font-mono">{formatDuration(tool.p50DurationMs)}</TableCell><TableCell className="text-right font-mono">{formatDuration(tool.p95DurationMs)}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </section>
  );
}
