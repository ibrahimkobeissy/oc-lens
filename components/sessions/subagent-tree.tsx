import Link from "next/link";
import { Bot, Clock3, GitBranch, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCost, formatDuration, formatNumber, formatTokens } from "@/lib/format";
import type { OcCost, OcTokens, SubagentNode } from "@/types/oc";

export interface SubagentRollup {
  tokens: OcTokens;
  toolCallCount: number;
  cost: OcCost;
}

function tokenTotal(tokens: OcTokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite;
}

function addTokens(left: OcTokens, right: OcTokens): OcTokens {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    reasoning: left.reasoning + right.reasoning,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
  };
}

function addCosts(left: OcCost, right: OcCost): OcCost {
  if (!left.priced || !right.priced) return { amount: 0, priced: false };
  return { amount: left.amount + right.amount, priced: true };
}

export function exclusiveSubagentRollup(node: SubagentNode): SubagentRollup {
  return { tokens: { ...node.tokens }, toolCallCount: node.toolCallCount, cost: { ...node.cost } };
}

export function inclusiveSubagentRollup(node: SubagentNode): SubagentRollup {
  return node.children.reduce<SubagentRollup>((total, child) => {
    const childTotal = inclusiveSubagentRollup(child);
    return {
      tokens: addTokens(total.tokens, childTotal.tokens),
      toolCallCount: total.toolCallCount + childTotal.toolCallCount,
      cost: addCosts(total.cost, childTotal.cost),
    };
  }, exclusiveSubagentRollup(node));
}

function TokenDetail({ tokens }: { tokens: OcTokens }) {
  return (
    <span
      className="text-xs text-muted-foreground"
      title={`Input ${formatNumber(tokens.input)} · Output ${formatNumber(tokens.output)} · Reasoning ${formatNumber(tokens.reasoning)} · Cache read ${formatNumber(tokens.cacheRead)} · Cache write ${formatNumber(tokens.cacheWrite)}`}
    >
      {formatTokens(tokenTotal(tokens))} tokens
    </span>
  );
}

function RollupCard({ label, rollup }: { label: string; rollup: SubagentRollup }) {
  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <TokenDetail tokens={rollup.tokens} />
        <span className="text-xs text-muted-foreground">{formatNumber(rollup.toolCallCount)} tool calls</span>
        <span className={rollup.cost.priced ? "font-mono text-sm" : "text-xs text-muted-foreground"}>{formatCost(rollup.cost)}</span>
      </div>
    </div>
  );
}

function TreeItem({ node, root = false }: { node: SubagentNode; root?: boolean }) {
  const model = node.model ? `${node.model.providerID}/${node.model.id}` : "unknown model";
  const hasChildren = node.children.length > 0;
  return (
    <li className="relative">
      <article className="min-w-0 rounded-lg border border-border bg-card p-3">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/sessions/${encodeURIComponent(node.sessionId)}`} className="break-all font-mono text-sm font-medium text-primary hover:underline">
                {node.sessionId}
              </Link>
              {root ? <Badge variant="secondary">Root session</Badge> : <Badge variant="outline">Subagent</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Bot aria-hidden="true" className="size-3.5" />{node.agent ?? "unknown agent"}</span>
              <span>{model}</span>
              <span className="inline-flex items-center gap-1"><Clock3 aria-hidden="true" className="size-3.5" />{formatDuration(node.durationMs)}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3 sm:justify-end">
            <TokenDetail tokens={node.tokens} />
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Wrench aria-hidden="true" className="size-3.5" />{formatNumber(node.toolCallCount)}</span>
            <span className={node.cost.priced ? "font-mono text-sm" : "text-xs text-muted-foreground"}>{formatCost(node.cost)}</span>
          </div>
        </div>
      </article>
      {hasChildren ? (
        <ul className="ml-3 space-y-3 border-l border-border py-3 pl-4 sm:ml-5 sm:pl-5">
          {node.children.map((child) => <TreeItem key={child.sessionId} node={child} />)}
        </ul>
      ) : null}
    </li>
  );
}

export function SubagentTree({ node }: { node: SubagentNode }) {
  if (node.children.length === 0) return null;
  const exclusive = exclusiveSubagentRollup(node);
  const inclusive = inclusiveSubagentRollup(node);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><GitBranch aria-hidden="true" className="size-4" />Subagent tree</CardTitle>
        <CardDescription>Delegated sessions and their recorded usage. Durations stay per session because subagents may run in parallel.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <RollupCard label="This session alone" rollup={exclusive} />
          <RollupCard label="Total including subagents" rollup={inclusive} />
        </div>
        <ul aria-label={`Subagent hierarchy rooted at ${node.sessionId}`} className="space-y-3">
          <TreeItem node={node} root />
        </ul>
      </CardContent>
    </Card>
  );
}
