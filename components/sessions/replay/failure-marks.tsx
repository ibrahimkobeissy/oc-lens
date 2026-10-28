"use client";

import { AlertOctagon, CornerDownRight, Hourglass, RefreshCw, Repeat2 } from "lucide-react";

import { formatCost, formatDuration, formatNumber } from "@/lib/format";
import type { SlowStep } from "@/lib/audit/slow-start-types";
import { FAILURE_KIND_LABELS, type FailedCall, type FailureIncident, type SessionFailureReport } from "@/lib/audit/failure-types";

export { FAILURE_KIND_LABELS };

export type FailureTurnMark =
  | { type: "failed"; call: FailedCall; attempt: number; attempts: number; incident: FailureIncident }
  | { type: "resend"; by: "opencode" | "you" }
  | { type: "recovery"; incident: FailureIncident };

export interface ReplayFailureMarks {
  turns: ReadonlyMap<string, FailureTurnMark>; // keyed by message id
  repeatedParts: ReadonlyMap<string, string>; // repeated call part id -> the earlier call it repeats
  slowStarts: ReadonlyMap<string, SlowStep>; // keyed by message id: steps that waited far longer than usual for their first token
}

export const NO_FAILURE_MARKS: ReplayFailureMarks = { turns: new Map(), repeatedParts: new Map(), slowStarts: new Map() };

/** Message- and part-level markers for one session's failure report. Pure, so the replay only looks them up. */
export function replayFailureMarks(report: SessionFailureReport | undefined, slowSteps: readonly SlowStep[] = []): ReplayFailureMarks {
  const turns = new Map<string, FailureTurnMark>();
  const repeatedParts = new Map<string, string>();
  for (const incident of report?.incidents ?? []) {
    // A step that succeeded after retries is its own recovery; the recovery banner tells both stories.
    const finalFailures = incident.failures.filter((call) => !call.succeeded);
    finalFailures.forEach((call, index) => turns.set(call.messageId, { type: "failed", call, attempt: index + 1, attempts: finalFailures.length, incident }));
    for (const resend of incident.resends) turns.set(resend.messageId, { type: "resend", by: resend.by });
    if (incident.recovery) turns.set(incident.recovery.messageId, { type: "recovery", incident });
    for (const call of incident.repeatedCalls) repeatedParts.set(call.partId, call.originalPartId);
  }
  return { turns, repeatedParts, slowStarts: new Map(slowSteps.map((step) => [step.messageId, step])) };
}

function waitText(value: number): string {
  return value < 60 ? `${Math.round(value)} s` : formatDuration(Math.round(value * 1000));
}

/** Timing only: never presented as a failure, because a slow provider looks exactly the same. */
export function SlowStartBanner({ step }: { step: SlowStep | undefined }) {
  if (!step) return null;
  const factor = step.waitSeconds / Math.max(step.baselineSeconds, 0.1);
  return (
    <p role="note" className="mb-3 flex flex-wrap items-center gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
      <Hourglass aria-hidden="true" className="size-3.5 text-warning" />
      <span className="font-medium">Slow start: waited {waitText(step.waitSeconds)} for the first token</span>
      <span className="text-muted-foreground">— {factor.toFixed(0)}× this model&apos;s usual {waitText(step.baselineSeconds)}. Possible hidden retries or a slow provider; opencode keeps no record of which.</span>
    </p>
  );
}

function retriesText(call: FailedCall): string | null {
  if (call.retries === null) return null;
  return `opencode retried this call ${call.retries} time${call.retries === 1 ? "" : "s"} inside this step${call.succeeded ? " before it succeeded" : ""}.`;
}

/** Requests the provider took (HTTP 2xx) with no usage recorded: the estimate, worded as one. */
export function acceptedUnrecordedText(incident: FailureIncident): string | null {
  const exposure = incident.acceptedUnrecorded;
  if (!exposure) return null;
  const requests = `${exposure.requests} request${exposure.requests === 1 ? "" : "s"}`;
  return exposure.tokens === null
    ? `The provider accepted ${requests} (HTTP 2xx) that broke before finishing, and opencode recorded no usage for them. There is no earlier step to estimate their size from.`
    : `The provider accepted ${requests} (HTTP 2xx) that broke before finishing, and opencode recorded no usage for them. Each resent about ${formatNumber(exposure.tokensPerRequest ?? 0)} tokens of context: ≈${formatNumber(exposure.tokens)} tokens the provider may have billed. An estimate — opencode does not record what these requests sent.`;
}

function FailedBanner({ mark }: { mark: Extract<FailureTurnMark, { type: "failed" }> }) {
  const { call } = mark;
  const usage = call.tokens ? call.tokens.input + call.tokens.output + call.tokens.reasoning + call.tokens.cacheRead + call.tokens.cacheWrite : 0;
  return (
    <div role="note" className={`mb-3 rounded-md border px-3 py-2 text-xs ${call.kind === "aborted" ? "border-border bg-muted/40" : "border-destructive/40 bg-destructive/5"}`}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
        <AlertOctagon aria-hidden="true" className={`size-3.5 ${call.kind === "aborted" ? "text-muted-foreground" : "text-destructive"}`} />
        Failed call — {FAILURE_KIND_LABELS[call.kind]}{call.status !== null ? ` · HTTP ${call.status}` : ""}{mark.attempts > 1 ? ` · attempt ${mark.attempt} of ${mark.attempts}` : ""}
      </p>
      {call.message ? <p className="mt-1 break-words text-muted-foreground">{call.message}</p> : null}
      {retriesText(call) ? <p className="mt-1">{retriesText(call)}</p> : null}
      <p className={`mt-1 ${usage > 0 ? "font-medium text-warning" : "text-muted-foreground"}`}>
        {usage > 0 ? `${formatNumber(usage)} tokens were recorded on this failed call — usage for a response that never arrived.` : `No tokens were recorded on this call.${call.retries === null ? " opencode did not save whether it retried inside it." : ""}`}
      </p>
      {call.accepted && acceptedUnrecordedText(mark.incident) ? <p className="mt-1 font-medium text-warning">{acceptedUnrecordedText(mark.incident)}</p> : null}
    </div>
  );
}

function ResendBanner({ by }: { by: "opencode" | "you" }) {
  return (
    <p role="note" className="mb-3 flex items-center gap-1.5 text-xs font-medium text-warning">
      <RefreshCw aria-hidden="true" className="size-3.5" />
      {by === "opencode" ? "Automatic resend by opencode after a failed call" : "You resent after a failed call"}
    </p>
  );
}

function RecoveryBanner({ incident }: { incident: FailureIncident }) {
  const recovery = incident.recovery;
  if (!recovery) return null;
  const failed = incident.failures.filter((call) => !call.succeeded).length;
  const retried = incident.failures.find((call) => call.succeeded && call.messageId === recovery.messageId);
  const lost = incident.cacheLost;
  const accepted = acceptedUnrecordedText(incident);
  return (
    <div role="note" className="mb-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
      <p className="flex items-center gap-1.5 font-medium"><CornerDownRight aria-hidden="true" className="size-3.5 text-warning" />{failed > 0 ? `Replay of a failed call — first success after ${failed} failed step${failed === 1 ? "" : "s"} and ${incident.resends.length} resend${incident.resends.length === 1 ? "" : "s"}` : "Succeeded after hidden retries"}</p>
      {retried ? <p className="mt-1">This step failed {retried.retries} time{retried.retries === 1 ? "" : "s"} first ({FAILURE_KIND_LABELS[retried.kind]}{retried.status !== null ? `, HTTP ${retried.status}` : ""}) — opencode retried it inside the step, so it never showed as a failed call.</p> : null}
      {accepted && !incident.failures.some((call) => call.accepted && !call.succeeded) ? <p className="mt-1 font-medium text-warning">{accepted}</p> : null}
      <p className="mt-1 text-muted-foreground">Sent {formatNumber(recovery.tokens.input)} input tokens at full price and read {formatNumber(recovery.tokens.cacheRead)} from cache{incident.before ? `; the step before the failure read ${formatNumber(incident.before.tokens.cacheRead)} from cache` : ""}.</p>
      {lost && lost.tokens > 0 ? <p className="mt-1 font-medium">{formatNumber(lost.tokens)} tokens of context were paid at the full input price instead of the cache price: {lost.extraCost.priced ? `+${formatCost(lost.extraCost)}` : "not priced — enter this model's prices to see the amount"}.</p> : null}
      {incident.repeatedCalls.length > 0 ? <p className="mt-1 text-muted-foreground">{incident.repeatedCalls.length} tool call{incident.repeatedCalls.length === 1 ? "" : "s"} after this point repeat{incident.repeatedCalls.length === 1 ? "s" : ""} a call made before the failure; {incident.repeatedCalls.length === 1 ? "it is" : "they are"} marked below.</p> : null}
    </div>
  );
}

export function FailureTurnBanner({ mark }: { mark: FailureTurnMark | undefined }) {
  if (!mark) return null;
  if (mark.type === "failed") return <FailedBanner mark={mark} />;
  if (mark.type === "resend") return <ResendBanner by={mark.by} />;
  return <RecoveryBanner incident={mark.incident} />;
}

export function RepeatedAfterFailureMark({ originalPartId, onJumpToPart }: { originalPartId: string; onJumpToPart?: (partId: string) => void }) {
  return (
    <p className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-warning">
      <span className="flex items-center gap-1.5"><Repeat2 aria-hidden="true" className="size-3" />Same call as one made before the failure — redone after the resend</span>
      {onJumpToPart ? <button type="button" className="underline underline-offset-2" onClick={() => onJumpToPart(originalPartId)}>Show the earlier call</button> : null}
    </p>
  );
}
