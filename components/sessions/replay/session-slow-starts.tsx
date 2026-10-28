"use client";

import { Hourglass } from "lucide-react";

import { SLOW_START_RULE, seconds } from "@/components/audit/slow-starts";
import { CollapsibleSection } from "@/components/layout/collapsible-section";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import type { SlowStartReport } from "@/lib/audit/slow-start-types";

/** One session's slow starts. Renders nothing when there are none or timing was not recorded. */
export function SessionSlowStarts({ report, onJumpToMessage }: { report: SlowStartReport; onJumpToMessage: (messageId: string) => void }) {
  if (report.slowSteps.length === 0) return null;
  const steps = report.byDay.reduce((sum, day) => sum + day.steps, 0);
  const longest = Math.max(...report.slowSteps.map((step) => step.waitSeconds));
  return (
    <CollapsibleSection
      aria-label="Slow starts in this session"
      className="border-warning/40"
      title={<><Hourglass aria-hidden="true" className="size-4 text-warning" />Slow starts in this session</>}
      description={`${formatNumber(report.slowSteps.length)} of ${formatNumber(steps)} steps waited far longer than usual for the model to start answering (longest ${seconds(longest)}). Possible hidden retries or a slow provider.`}
      bodyClassName="space-y-3"
    >
      <p className="text-xs text-muted-foreground">{SLOW_START_RULE} opencode deletes the record of retries that ended in success, so this timing is the only trace they leave — and it cannot tell them apart from a provider that was just slow.</p>
      <ul className="divide-y divide-border rounded-md border border-border text-sm">{report.slowSteps.map((step) => (
        <li key={step.messageId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <span className="font-mono font-semibold text-warning">{seconds(step.waitSeconds)}</span>
          <span className="text-xs text-muted-foreground">{(step.waitSeconds / Math.max(step.baselineSeconds, 0.1)).toFixed(0)}× usual {seconds(step.baselineSeconds)}</span>
          <time suppressHydrationWarning className="text-xs text-muted-foreground" dateTime={new Date(step.timeCreated).toISOString()}>{new Date(step.timeCreated).toLocaleString()}</time>
          <Button type="button" variant="ghost" size="xs" className="ml-auto" onClick={() => onJumpToMessage(step.messageId)}>Go to step</Button>
        </li>
      ))}</ul>
    </CollapsibleSection>
  );
}
