import { Server } from "lucide-react";

import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatNumber } from "@/lib/format";
import { TOOL_CATEGORIES } from "@/lib/tools/categories";
import type { McpServerSummary, ToolSummary } from "@/types/oc";

interface PanelServer extends McpServerSummary {
  inferred: boolean;
}

/**
 * MCP servers for tools no configured server claims — typically sessions run
 * (or imported) from a machine whose opencode config is not this one. MCP tools
 * are named `<server>_<tool>`, so the server is read up to the first underscore:
 * right for `tracker_issue_get`, wrong for a server whose own name has an
 * underscore, which is why these are labelled inferred.
 */
export function inferredMcpServers(configured: readonly McpServerSummary[], tools: readonly ToolSummary[]): McpServerSummary[] {
  const claimed = new Set(configured.flatMap((server) => server.tools.map((tool) => `${server.server}_${tool.tool}`)));
  const byServer = new Map<string, McpServerSummary>();
  for (const tool of tools) {
    const separator = tool.tool.indexOf("_");
    if (separator <= 0 || separator === tool.tool.length - 1) continue;
    if (Object.hasOwn(TOOL_CATEGORIES, tool.tool.toLowerCase()) || claimed.has(tool.tool)) continue;
    const name = tool.tool.slice(0, separator);
    const server = byServer.get(name) ?? { server: name, toolCalls: 0, errorCount: 0, tools: [] };
    server.toolCalls += tool.totalCalls;
    server.errorCount += tool.errorCount;
    server.tools.push({ tool: tool.tool.slice(separator + 1), calls: tool.totalCalls });
    byServer.set(name, server);
  }
  return [...byServer.values()]
    .map((server) => ({ ...server, tools: server.tools.sort((left, right) => right.calls - left.calls || left.tool.localeCompare(right.tool)) }))
    .sort((left, right) => right.toolCalls - left.toolCalls || left.server.localeCompare(right.server));
}

export function McpServerPanel({ servers, tools = [] }: { servers: McpServerSummary[]; tools?: ToolSummary[] }) {
  const all: PanelServer[] = [
    ...servers.map((server) => ({ ...server, inferred: false })),
    ...inferredMcpServers(servers, tools).map((server) => ({ ...server, inferred: true })),
  ];
  if (all.length === 0) {
    return <EmptyState icon={<Server />} title="No MCP server activity" description="No MCP tool was called in this range." />;
  }
  return (
    <section className="space-y-4" aria-labelledby="mcp-heading">
      <div><h2 id="mcp-heading" className="font-semibold">MCP servers</h2><p className="mt-1 text-xs text-muted-foreground">Servers from this machine&apos;s opencode config, plus servers inferred from tool names for calls no configured server claims.</p></div>
      <div className="grid gap-4 lg:grid-cols-2">
        {all.map((server) => {
          const rate = server.toolCalls === 0 ? 0 : (server.errorCount / server.toolCalls) * 100;
          return <article key={`${server.inferred ? "inferred" : "configured"}:${server.server}`} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex flex-wrap items-center gap-2 font-mono font-medium">{server.server}{server.inferred ? <Badge variant="outline" className="font-sans text-[10px] font-normal" title="Not in this machine's opencode config: the server name is read from the tool names, up to the first underscore.">inferred from tool names</Badge> : null}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{formatNumber(server.toolCalls)} calls · {formatNumber(server.errorCount)} errors</p>
              </div>
              <span className="font-mono text-sm">{rate.toFixed(1)}%</span>
            </div>
            <Progress className="mt-3" value={rate} aria-label={`${server.server} error rate`} />
            <ul className="mt-4 divide-y divide-border text-sm">{server.tools.map((tool) => <li key={tool.tool} className="flex justify-between gap-3 py-2"><span className="font-mono">{tool.tool}</span><span className="text-muted-foreground">{formatNumber(tool.calls)} calls</span></li>)}</ul>
          </article>;
        })}
      </div>
    </section>
  );
}
