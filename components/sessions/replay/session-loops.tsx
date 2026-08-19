"use client";

import { AlertTriangle, RefreshCw, Repeat2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCost, formatNumber } from "@/lib/format";
import { MIN_REPEAT_CHOICES } from "@/lib/loops";
import type { LoopAnalysis, LoopKind } from "@/types/oc";

const KIND_LABEL: Record<LoopKind, { label: string; icon: typeof AlertTriangle }> = {
  "error-retry": { label: "Error retry", icon: AlertTriangle },
  "redundant-repeat": { label: "Redundant repeat", icon: RefreshCw },
  oscillation: { label: "Oscillation", icon: Repeat2 },
};

/**
 * Loops found in this session, each able to jump to the turn it started in.
 *
 * The Loops page answers "where is time going overall"; this answers the
 * question you actually act on — "what was it stuck on here" — which is only
 * answerable with the surrounding conversation in view.
 */
export function SessionLoops({
  analysis,
  onJumpToPart,
  minRepeats,
  onMinRepeatsChange,
}: {
  analysis: LoopAnalysis;
  onJumpToPart: (partId: string) => void;
  minRepeats: number;
  onMinRepeatsChange: (value: number) => void;
}) {
  const threshold = (
    <label className="text-xs font-normal text-muted-foreground">
      Repeats
      <select
        aria-label="Minimum repeats"
        className="ml-2 h-7 rounded-md border border-input bg-background px-2 text-xs"
        value={minRepeats}
        onChange={(event) => onMinRepeatsChange(Number(event.target.value))}
      >
        {MIN_REPEAT_CHOICES.map((value) => (
          <option key={value} value={value}>{value}+</option>
        ))}
      </select>
    </label>
  );

  // Rendering nothing when nothing is found is indistinguishable from a broken
  // panel. Say so, and say what threshold produced that answer.
  if (analysis.incidents.length === 0) {
    return (
      <Card>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <Repeat2 aria-hidden="true" className="size-4 text-muted-foreground" />
              No loops in this session
            </h2>
            {threshold}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            No call ran {minRepeats} or more times here. Reading different files, or reading one file twice far
            apart, is ordinary work and is deliberately not counted.
            {minRepeats > MIN_REPEAT_CHOICES[0] ? " Lower the repeats threshold to widen the search." : ""}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Repeat2 aria-hidden="true" className="size-4 text-warning" />
            Loops in this session
          </h2>
          <div className="flex items-center gap-3">
            {threshold}
          </div>
        </div>
        <div className="mb-3">
          <p className="text-xs text-muted-foreground">
            {formatNumber(analysis.totalWastedCalls)} redundant run
            {analysis.totalWastedCalls === 1 ? "" : "s"}
            {analysis.totalRepeatedTurnCost.priced
              ? ` · ${formatCost(analysis.totalRepeatedTurnCost)} of turns`
              : ""}
          </p>
        </div>
        <ul className="space-y-2">
          {analysis.incidents.map((incident) => {
            const meta = KIND_LABEL[incident.kind];
            const Icon = meta.icon;
            const firstPart = incident.partIds[0];
            return (
              <li
                key={`${incident.sessionId}:${incident.signature}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
              >
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Icon aria-hidden="true" className="size-3.5 text-warning" />
                  {meta.label}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{incident.tool}</span>
                <span className="text-xs text-muted-foreground">
                  {formatNumber(incident.calls)} calls · {formatNumber(incident.wastedCalls)} repeated
                </span>
                {firstPart !== undefined && (
                  <button
                    type="button"
                    onClick={() => onJumpToPart(firstPart)}
                    className="ml-auto cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-primary underline-offset-2 hover:bg-accent hover:underline"
                  >
                    Jump to first call
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
