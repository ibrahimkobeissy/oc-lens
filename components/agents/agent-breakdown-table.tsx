import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCost, formatDuration, formatNumber, formatTokens } from "@/lib/format";
import type { AgentSummary, OcTokens } from "@/types/oc";

function totalTokens(tokens: OcTokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite;
}

export function toolCallCount(agent: AgentSummary): number {
  return agent.toolMix.reduce((total, tool) => total + tool.calls, 0);
}

export function errorRate(agent: AgentSummary): number | null {
  const calls = toolCallCount(agent);
  return calls === 0 ? null : agent.errorCount / calls;
}

export function AgentBreakdownTable({ agents }: { agents: AgentSummary[] }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead><TableHead>Sessions</TableHead><TableHead>Messages</TableHead>
            <TableHead>Tokens</TableHead><TableHead>Cost</TableHead><TableHead>Error rate</TableHead>
            <TableHead>Avg session</TableHead><TableHead>Tool mix</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent) => {
            const calls = toolCallCount(agent);
            const rate = errorRate(agent);
            return (
              <TableRow key={agent.agent}>
                <TableCell>
                  <Badge variant={agent.agent === "unknown" ? "outline" : "secondary"} className="font-mono">
                    {agent.agent}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono tabular-nums">{formatNumber(agent.sessionCount)}</TableCell>
                <TableCell className="font-mono tabular-nums">{formatNumber(agent.messageCount)}</TableCell>
                <TableCell className="font-mono tabular-nums" title={`${formatNumber(totalTokens(agent.tokens))} tokens`}>
                  {formatTokens(totalTokens(agent.tokens))}
                </TableCell>
                <TableCell className={agent.cost.priced ? "font-mono tabular-nums" : "text-muted-foreground"}>{formatCost(agent.cost)}</TableCell>
                <TableCell>
                  {rate === null ? <span className="text-muted-foreground">—</span> : (
                    <span title={`${agent.errorCount} errors across ${calls} tool calls`}>
                      {(rate * 100).toFixed(1)}% <span className="text-xs text-muted-foreground">({agent.errorCount}/{calls})</span>
                    </span>
                  )}
                </TableCell>
                <TableCell>{formatDuration(agent.avgSessionLengthMs)}</TableCell>
                <TableCell>
                  {agent.toolMix.length === 0 ? <span className="text-muted-foreground">No tool calls</span> : (
                    <ul className="flex max-w-md flex-wrap gap-1.5" aria-label={`${agent.agent} tool mix`}>
                      {agent.toolMix.map((tool) => <li key={tool.tool}><Badge variant="outline" className="font-mono">{tool.tool} {tool.calls}</Badge></li>)}
                    </ul>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
