import { AlertTriangle, Server } from "lucide-react";

import { EmptyState } from "@/components/states/empty-state";
import { Progress } from "@/components/ui/progress";
import { formatNumber } from "@/lib/format";
import type { McpServerSummary, ToolSummary } from "@/types/oc";

export function unresolvedMcpTools(servers: readonly McpServerSummary[], tools: readonly ToolSummary[]): ToolSummary[] {
  const resolvedNames = new Set(servers.flatMap((server) => server.tools.map((tool) => `${server.server}_${tool.tool}`)));
  return tools.filter((tool) => tool.tool.includes("_") && !resolvedNames.has(tool.tool)).sort((left, right) => right.totalCalls - left.totalCalls || left.tool.localeCompare(right.tool));
}

export function McpServerPanel({ servers, tools }: { servers: McpServerSummary[]; tools: ToolSummary[] }) {
  const unresolved = unresolvedMcpTools(servers, tools);
  if (servers.length === 0 && unresolved.length === 0) {
    return <EmptyState icon={<Server />} title="No MCP server activity" description="No configured MCP server produced a resolved tool call in this range." />;
  }
  return (
    <section className="space-y-4" aria-labelledby="mcp-heading">
      <div><h2 id="mcp-heading" className="font-semibold">MCP servers</h2><p className="mt-1 text-xs text-muted-foreground">Server names use the configured longest-prefix resolver; ambiguous underscores are never guessed.</p></div>
      <div className="grid gap-4 lg:grid-cols-2">
        {servers.map((server) => {
          const rate = server.toolCalls === 0 ? 0 : (server.errorCount / server.toolCalls) * 100;
          return <article key={server.server} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3"><div><h3 className="font-mono font-medium">{server.server}</h3><p className="mt-1 text-xs text-muted-foreground">{formatNumber(server.toolCalls)} calls · {formatNumber(server.errorCount)} errors</p></div><span className="font-mono text-sm">{rate.toFixed(1)}%</span></div>
            <Progress className="mt-3" value={rate} aria-label={`${server.server} error rate`} />
            <ul className="mt-4 divide-y divide-border text-sm">{server.tools.map((tool) => <li key={tool.tool} className="flex justify-between gap-3 py-2"><span className="font-mono">{tool.tool}</span><span className="text-muted-foreground">{formatNumber(tool.calls)} calls</span></li>)}</ul>
          </article>;
        })}
      </div>
      {unresolved.length > 0 && <div className="rounded-lg border border-warning/40 bg-warning/5 p-4"><div className="flex gap-2"><AlertTriangle className="size-4 shrink-0 text-warning" /><div><h3 className="text-sm font-medium">Unresolved MCP-shaped tools</h3><p className="mt-1 text-xs text-muted-foreground">These underscore-containing names matched no configured server prefix, so oc-lens leaves them unresolved instead of guessing.</p></div></div><ul className="mt-3 divide-y divide-border text-sm">{unresolved.map((tool) => <li key={tool.tool} className="flex justify-between py-2"><code>{tool.tool}</code><span>{formatNumber(tool.totalCalls)} calls</span></li>)}</ul></div>}
    </section>
  );
}
