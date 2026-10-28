"use client";

import Link from "next/link";
import { Hourglass } from "lucide-react";

import { CollapsibleSection } from "@/components/layout/collapsible-section";
import { Badge } from "@/components/ui/badge";
import { TablePager, useClientPaging } from "@/components/ui/table-pager";
import { formatDuration, formatNumber } from "@/lib/format";
import { SLOW_START_FACTOR, SLOW_START_MIN_SECONDS, type SlowStartReport } from "@/lib/audit/slow-start-types";

export function seconds(value: number): string {
  return value < 60 ? `${value.toFixed(1)} s` : formatDuration(Math.round(value * 1000));
}

export const SLOW_START_RULE = `A step is a slow start when it waited at least ${SLOW_START_MIN_SECONDS} s and more than ${SLOW_START_FACTOR}× its model's usual wait for the first token.`;

/**
 * Days and steps where the model took far longer than usual to start
 * answering. opencode deletes the record of retries that ended in success, so
 * this timing is the only trace they leave — and a merely slow provider looks
 * the same, which the wording says every time.
 */
export function SlowStarts({ report }: { report: SlowStartReport }) {
  const total = report.slowSteps.length;
  const steps = useClientPaging([...report.slowSteps].sort((left, right) => right.timeCreated - left.timeCreated), 10);
  return (
    <CollapsibleSection
      defaultOpen
      aria-label="Slow starts"
      title={<><Hourglass aria-hidden="true" className="size-4" />Slow starts — possible hidden retries or slow provider</>}
      description={`opencode deletes the record of retries that ended in success; the time a step waited for its first token is the trace they leave. ${SLOW_START_RULE}`}
      aside={report.measurable ? <Badge variant={total > 0 ? "secondary" : "outline"}>{formatNumber(total)} slow</Badge> : undefined}
      bodyClassName="space-y-4"
    >
      {!report.measurable ? (
        <p className="text-sm text-muted-foreground">Not measurable: no step in this database records when its first token arrived. opencode 1.x does not store it.</p>
      ) : report.byDay.length === 0 ? (
        <p className="text-sm text-muted-foreground">No measured steps in this range.</p>
      ) : <>
        <div className="max-w-full overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Day</th><th className="px-3 py-2 text-right font-medium">Steps</th><th className="px-3 py-2 text-right font-medium">Median wait</th><th className="px-3 py-2 text-right font-medium">Slowest 10%</th><th className="px-3 py-2 text-right font-medium">Slow starts</th></tr></thead>
            <tbody className="divide-y divide-border">{report.byDay.map((day) => (
              <tr key={day.date} className={day.slowSteps > 0 ? undefined : "text-muted-foreground"}>
                <td className="px-3 py-2 font-mono">{day.date}</td>
                <td className="px-3 py-2 text-right font-mono">{formatNumber(day.steps)}</td>
                <td className="px-3 py-2 text-right font-mono">{seconds(day.medianSeconds)}</td>
                <td className="px-3 py-2 text-right font-mono">≥ {seconds(day.p90Seconds)}</td>
                <td className={`px-3 py-2 text-right font-mono ${day.slowSteps > 0 ? "font-semibold text-warning" : ""}`}>{formatNumber(day.slowSteps)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {total > 0 ? <div className="space-y-3">
          <h3 className="text-sm font-medium">Slow starts, newest first</h3>
          <ul className="divide-y divide-border rounded-md border border-border text-sm">{steps.visible.map((step) => (
            <li key={step.messageId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="font-mono font-semibold text-warning">{seconds(step.waitSeconds)}</span>
              <span className="text-xs text-muted-foreground">{(step.waitSeconds / Math.max(step.baselineSeconds, 0.1)).toFixed(0)}× usual {seconds(step.baselineSeconds)} · {step.model}</span>
              <Link href={`/sessions/${encodeURIComponent(step.sessionId)}`} className="min-w-0 truncate font-medium hover:underline">{step.sessionTitle}</Link>
              <time suppressHydrationWarning className="ml-auto text-xs text-muted-foreground" dateTime={new Date(step.timeCreated).toISOString()}>{new Date(step.timeCreated).toLocaleString()}</time>
            </li>
          ))}</ul>
          <TablePager noun={["slow start", "slow starts"]} {...steps.pagerProps} />
        </div> : null}
      </>}
    </CollapsibleSection>
  );
}
