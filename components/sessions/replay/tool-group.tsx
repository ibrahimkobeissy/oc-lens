"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Layers3 } from "lucide-react";

import { partDomId } from "./part-registry";
import { ToolPart } from "./tool-part";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { categorizeTool, categoryColor, toolDisplayName } from "@/lib/tools";
import type { ReplayPart, ReplayTurn } from "@/types/oc";

export type ReplayToolDisplayItem =
  | { kind: "part"; part: ReplayPart }
  | { kind: "tool-group"; tool: string; parts: ReplayPart[] };

export function groupConsecutiveToolParts(parts: readonly ReplayPart[]): ReplayToolDisplayItem[] {
  const result: ReplayToolDisplayItem[] = [];
  let index = 0;
  while (index < parts.length) {
    const part = parts[index];
    if (!part || part.data.type !== "tool") {
      if (part) result.push({ kind: "part", part });
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < parts.length) {
      const candidate = parts[end];
      if (!candidate || candidate.data.type !== "tool" || candidate.data.tool !== part.data.tool) break;
      end += 1;
    }
    const run = parts.slice(index, end);
    if (run.length >= 3) result.push({ kind: "tool-group", tool: part.data.tool, parts: run });
    else run.forEach((entry) => result.push({ kind: "part", part: entry }));
    index = end;
  }
  return result;
}

export function ToolGroup({ parts, turn, defaultExpanded = false, targetPartId }: { parts: ReplayPart[]; turn: ReplayTurn; defaultExpanded?: boolean; targetPartId?: string | null }) {
  const [userExpanded, setUserExpanded] = useState(defaultExpanded);
  const targetExpanded = targetPartId !== null && targetPartId !== undefined && parts.some((part) => part.id === targetPartId);
  const expanded = userExpanded || targetExpanded;
  const first = parts.find((part) => part.data.type === "tool");
  const tool = first?.data.type === "tool" ? first.data.tool : "";
  const category = categorizeTool(tool);
  const displayName = toolDisplayName(tool) || "unknown tool";
  const statuses = { completed: 0, error: 0, pending: 0, running: 0, unknown: 0 };
  for (const part of parts) if (part.data.type === "tool") statuses[part.data.status] += 1;
  return <section className="rounded-lg border bg-muted/20 p-3" aria-label={`${parts.length} consecutive ${displayName} tool calls`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Layers3 aria-hidden="true" className="size-4" style={{ color: categoryColor(category) }} />
        <span className="font-medium">{parts.length} consecutive {displayName} calls</span>
        <Badge variant="outline" style={{ borderColor: categoryColor(category) }}>{category}</Badge>
        {statuses.completed > 0 ? <Badge variant="secondary">{statuses.completed} completed</Badge> : null}
        {statuses.error > 0 ? <Badge variant="destructive">{statuses.error} failed</Badge> : null}
        {statuses.pending > 0 ? <Badge variant="outline">{statuses.pending} pending</Badge> : null}
        {statuses.running > 0 ? <Badge>{statuses.running} running</Badge> : null}
        {statuses.unknown > 0 ? <Badge variant="outline">{statuses.unknown} unknown</Badge> : null}
      </div>
      <Button type="button" variant="ghost" size="xs" aria-expanded={expanded} onClick={() => setUserExpanded((value) => !value)}>
        {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        {expanded ? "Collapse calls" : "Expand calls"}
      </Button>
    </div>
    {expanded ? <div className="mt-3 space-y-3">{parts.map((part) => <div key={part.id} id={partDomId(part.id)} data-part-id={part.id} tabIndex={-1} className="scroll-mt-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ToolPart part={part} turn={turn} /></div>)}</div> : null}
  </section>;
}
