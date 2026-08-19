"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCw, Repeat2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCost, formatNumber } from "@/lib/format";
import type { LoopIncident, LoopKind } from "@/types/oc";

const KIND: Record<LoopKind, { label: string; description: string; icon: typeof AlertTriangle; className: string }> = {
  "error-retry": {
    label: "Error retry",
    description: "The same call failed over and over",
    icon: AlertTriangle,
    className: "bg-destructive/10 text-destructive",
  },
  "redundant-repeat": {
    label: "Redundant repeat",
    description: "The same call succeeded over and over, returning nothing new",
    icon: RefreshCw,
    className: "bg-primary/10 text-foreground",
  },
  oscillation: {
    label: "Oscillation",
    description: "One file rewritten back and forth between contents it already had",
    icon: Repeat2,
    className: "bg-warning/10 text-foreground",
  },
};

function KindBadge({ kind }: { kind: LoopKind }) {
  const meta = KIND[kind];
  const Icon = meta.icon;
  return (
    <span
      title={meta.description}
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", meta.className)}
    >
      <Icon aria-hidden="true" className="size-3" />
      {meta.label}
    </span>
  );
}

/**
 * Incidents ranked by the cost of the turns containing them. Each row
 * deep-links to the exact first call in replay, because the useful question is
 * never "how many" — it is "what was it actually stuck on".
 */
export function LoopIncidentTable({ incidents }: { incidents: LoopIncident[] }) {
  if (incidents.length === 0) return null;

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <caption className="sr-only">Detected loops, ranked by the cost of the turns containing them</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-4 py-2 font-medium">Kind</th>
            <th scope="col" className="px-4 py-2 font-medium">Tool</th>
            <th scope="col" title="How many times this identical call ran in the session" className="px-4 py-2 text-right font-medium">Times run</th>
            <th scope="col" title="Runs after the first — the ones that produced nothing new" className="px-4 py-2 text-right font-medium">Redundant runs</th>
            <th scope="col" className="px-4 py-2 text-right font-medium" title="Other tool calls between the first and last repeat — a low number means a tight run">Calls between</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Turn cost</th>
            <th scope="col" className="px-4 py-2 font-medium">Session</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident) => {
            const firstPart = incident.partIds[0];
            const href = firstPart
              ? `/sessions/${incident.sessionId}?part=${encodeURIComponent(firstPart)}`
              : `/sessions/${incident.sessionId}`;
            return (
              <tr key={`${incident.sessionId}:${incident.signature}`} className="border-b border-border last:border-0">
                <td className="px-4 py-2"><KindBadge kind={incident.kind} /></td>
                <td className="px-4 py-2 font-mono text-xs">{incident.tool}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(incident.calls)}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium">{formatNumber(incident.wastedCalls)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatNumber(incident.interveningCalls)}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium">{formatCost(incident.repeatedTurnCost)}</td>
                <td className="px-4 py-2">
                  <Link className="text-primary underline-offset-2 hover:underline" href={href}>
                    Open in replay
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
