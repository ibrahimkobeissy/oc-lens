"use client";

import { CollapsibleSection } from "@/components/layout/collapsible-section";
import { Button } from "@/components/ui/button";
import { formatCost, formatNumber } from "@/lib/format";
import type { SessionFailureReport } from "@/lib/audit/failure-types";
import type { OcTokens } from "@/types/oc";
import { FAILURE_KIND_LABELS } from "./failure-marks";

function total(tokens: OcTokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite;
}

function cacheLostCost(report: SessionFailureReport): string {
  const { cacheLostExtraAmount, cacheLostUnpriced } = report.overhead;
  const pricedLosses = report.incidents.filter((incident) => incident.cacheLost && incident.cacheLost.tokens > 0 && incident.cacheLost.extraCost.priced).length;
  if (pricedLosses === 0) return formatCost({ amount: 0, priced: false });
  const amount = `+${formatCost({ amount: cacheLostExtraAmount, priced: true })}`;
  return cacheLostUnpriced > 0 ? `${amount} (partial)` : amount;
}

/**
 * What failed provider calls added to this session. Failed calls normally
 * record no usage, so subtracting them from the total changes nothing; the
 * cost of a failure is the context paid at full price afterwards and any work
 * the model redid. Renders nothing for a session without failures.
 */
export function SessionFailures({ report, sessionTokens, onJumpToMessage }: { report: SessionFailureReport; sessionTokens: OcTokens; onJumpToMessage: (messageId: string) => void }) {
  if (report.incidents.length === 0) return null;
  const { overhead } = report;
  const recorded = total(overhead.failedCallTokens);
  const resends = report.incidents.reduce((sum, incident) => sum + incident.resends.length, 0);
  return (
    <CollapsibleSection aria-label="Failed calls in this session" className="border-warning/40" title="Failed calls in this session" description={<>{formatNumber(overhead.failedCalls)} failed call{overhead.failedCalls === 1 ? "" : "s"}, {formatNumber(overhead.hiddenRetries)} retr{overhead.hiddenRetries === 1 ? "y" : "ies"} opencode made inside steps, and {formatNumber(resends)} resend{resends === 1 ? "" : "s"}. Each one is marked in the replay below.</>} bodyClassName="space-y-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          <div className="rounded-md border border-border p-3"><dt className="text-xs text-muted-foreground">Session total</dt><dd className="mt-1 font-mono text-lg">{formatNumber(total(sessionTokens))}</dd><dd className="text-xs text-muted-foreground">tokens recorded by opencode</dd></div>
          <div className={`rounded-md border p-3 ${recorded > 0 ? "border-warning/50 bg-warning/5" : "border-border"}`}><dt className="text-xs text-muted-foreground">Recorded on failed calls</dt><dd className="mt-1 font-mono text-lg">{formatNumber(recorded)}</dd><dd className="text-xs text-muted-foreground">{recorded > 0 ? "extra tokens for responses that never arrived" : "failed calls added no tokens to the total"}</dd></div>
          <div className={`rounded-md border p-3 ${overhead.cacheLostTokens > 0 ? "border-warning/50 bg-warning/5" : "border-border"}`}><dt className="text-xs text-muted-foreground">Cache lost after a failure</dt><dd className="mt-1 font-mono text-lg">{formatNumber(overhead.cacheLostTokens)}</dd><dd className="text-xs text-muted-foreground">tokens paid at full input price instead of cache price · {cacheLostCost(report)}</dd></div>
          <div className="rounded-md border border-border p-3"><dt className="text-xs text-muted-foreground">Calls redone after a failure</dt><dd className="mt-1 font-mono text-lg">{formatNumber(overhead.repeatedCalls)}</dd><dd className="text-xs text-muted-foreground">exact repeats of calls made before it</dd></div>
          <div className={`rounded-md border p-3 ${overhead.acceptedUnrecordedRequests > 0 ? "border-warning/50 bg-warning/5" : "border-border"}`}><dt className="text-xs text-muted-foreground">Accepted, never recorded</dt><dd className="mt-1 font-mono text-lg">{overhead.acceptedUnrecordedRequests > 0 ? `≈${formatNumber(overhead.acceptedUnrecordedTokens)}` : "0"}</dd><dd className="text-xs text-muted-foreground">{overhead.acceptedUnrecordedRequests > 0 ? `tokens (estimate) in ${formatNumber(overhead.acceptedUnrecordedRequests)} request${overhead.acceptedUnrecordedRequests === 1 ? "" : "s"} the provider took (HTTP 2xx) but opencode has no usage for` : "no request the provider accepted went unrecorded"}</dd></div>
        </dl>
        <p className="text-xs text-muted-foreground">Subtracting failed calls from the total changes nothing when they recorded no usage — the extra cost of a failure is the cache price lost on the replay and any work redone.</p>
        <ol className="space-y-2 text-sm">
          {report.incidents.map((incident, index) => {
            const kinds = [...new Set(incident.failures.map((call) => FAILURE_KIND_LABELS[call.kind]))].join(", ");
            const first = incident.failures[0];
            return (
              <li key={first?.messageId ?? index} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2">
                <span className="font-medium">{kinds} × {incident.failures.length}</span>
                <span className="text-xs text-muted-foreground">{incident.autoResends} automatic resend{incident.autoResends === 1 ? "" : "s"} · {incident.userResends} by you</span>
                <span className="text-xs text-muted-foreground">{incident.recovery ? `recovered · cache lost ${formatNumber(incident.cacheLost?.tokens ?? 0)}` : "never recovered"}</span>
                <span className="ml-auto flex gap-2">
                  {first ? <Button type="button" variant="ghost" size="xs" onClick={() => onJumpToMessage(first.messageId)}>Go to failure</Button> : null}
                  {incident.recovery ? <Button type="button" variant="ghost" size="xs" onClick={() => onJumpToMessage(incident.recovery?.messageId ?? "")}>Go to replay</Button> : null}
                </span>
              </li>
            );
          })}
        </ol>
    </CollapsibleSection>
  );
}
