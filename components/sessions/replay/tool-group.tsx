"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Layers3, Repeat2 } from "lucide-react";

import { partDomId } from "./part-registry";
import { ToolPart } from "./tool-part";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { categorizeTool, categoryColor, toolDisplayName } from "@/lib/tools";
import { cn } from "@/lib/utils";
import type { ReplayPart, ReplayTurn } from "@/types/oc";

/**
 * Where one repeated call sits inside its incident. Declared here rather than in
 * `turn-cards` because both this file and that one render marked parts, and
 * `turn-cards` already imports from here.
 */
export interface LoopPartMark {
  position: number;
  total: number;
  /** Every run in this incident, in order, so a marker can navigate to the others. */
  partIds: readonly string[];
}

/**
 * The marker on a single repeated call.
 *
 * Deliberately per call and never per turn or per group: a turn that reads five
 * files where one is a repeat must show one marker, not five. Getting this wrong
 * once already made the page look like it was flagging ordinary work.
 */
export function LoopMark({ mark, onJumpToPart }: { mark: LoopPartMark; onJumpToPart?: (partId: string) => void }) {
  return (
    <p className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-warning">
      <span className="flex items-center gap-1.5">
        <Repeat2 aria-hidden="true" className="size-3" />
        Same call, run {mark.total}× in this session — this is run {mark.position}
      </span>
      {/* The other runs can be hundreds of calls away, so a marker without a way
          to reach them is a dead end. */}
      {onJumpToPart !== undefined &&
        mark.partIds.map((partId, index) =>
          index + 1 === mark.position ? null : (
            <button
              key={partId}
              type="button"
              onClick={() => onJumpToPart(partId)}
              className="cursor-pointer rounded border border-warning/40 px-1.5 py-0.5 text-[10px] hover:bg-warning/10"
            >
              Go to run {index + 1}
            </button>
          ),
        )}
    </p>
  );
}

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

/**
 * `userOverride === null` means no explicit click yet, so the target/default wins; once
 * the user clicks, their choice sticks even while `?part=` still targets this group.
 * (code-review-2026-08-02.md M4: "Collapse calls" previously did nothing, because
 * `userExpanded || targetExpanded` kept forcing the group back open regardless of the click.)
 */
export function effectiveExpanded(userOverride: boolean | null, targetExpanded: boolean, defaultExpanded: boolean): boolean {
  return userOverride ?? (targetExpanded || defaultExpanded);
}

export function ToolGroup({ parts, turn, defaultExpanded = false, targetPartId, loopParts, onJumpToPart }: { parts: ReplayPart[]; turn: ReplayTurn; defaultExpanded?: boolean; targetPartId?: string | null; loopParts?: ReadonlyMap<string, LoopPartMark>; onJumpToPart?: (partId: string) => void }) {
  const [userOverride, setUserOverride] = useState<boolean | null>(null);
  const targetExpanded = targetPartId !== null && targetPartId !== undefined && parts.some((part) => part.id === targetPartId);
  const expanded = effectiveExpanded(userOverride, targetExpanded, defaultExpanded);
  const first = parts.find((part) => part.data.type === "tool");
  const tool = first?.data.type === "tool" ? first.data.tool : "";
  const category = categorizeTool(tool);
  const displayName = toolDisplayName(tool) || "unknown tool";
  const statuses = { completed: 0, error: 0, pending: 0, running: 0, unknown: 0 };
  for (const part of parts) if (part.data.type === "tool") statuses[part.data.status] += 1;
  // Named on the header too, so a collapsed group still says a repeat is inside it.
  const repeatedCount = loopParts === undefined ? 0 : parts.filter((part) => loopParts.has(part.id)).length;
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
        {repeatedCount > 0 ? <span title="These calls are not a loop with each other — each one separately also runs elsewhere in this session" className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-foreground"><Repeat2 aria-hidden="true" className="size-3" />{repeatedCount} also run elsewhere</span> : null}
      </div>
      <Button type="button" variant="ghost" size="xs" aria-expanded={expanded} onClick={() => setUserOverride(!expanded)}>
        {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        {expanded ? "Collapse calls" : "Expand calls"}
      </Button>
    </div>
    {expanded ? <div className="mt-3 space-y-3">{parts.map((part) => { const mark = loopParts?.get(part.id); return <div key={part.id} id={partDomId(part.id)} data-part-id={part.id} data-looped={mark !== undefined || undefined} tabIndex={-1} className={cn("scroll-mt-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", mark && "rounded-md ring-1 ring-warning/60")}>{mark ? <LoopMark mark={mark} onJumpToPart={onJumpToPart} /> : null}<ToolPart part={part} turn={turn} /></div>; })}</div> : null}
  </section>;
}
