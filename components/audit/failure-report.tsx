"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { BarChartCard } from "@/components/charts/bar-chart-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TablePager, useClientPaging } from "@/components/ui/table-pager";
import { formatCost, formatDuration, formatNumber } from "@/lib/format";
import { FAILURE_KIND_LABELS, FAILURE_KINDS, type FailureIncident, type FailuresReport } from "@/lib/audit/failure-types";
import type { OcTokens } from "@/types/oc";

export const KIND_LABELS = FAILURE_KIND_LABELS;

function tokenTotal(tokens: OcTokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite;
}

/** Same honesty rule as the daily tables: a partial sum is labelled, nothing priced reads "not priced". */
export function resendCostLabel(amount: number, unpriced: number, priced: number): string {
  if (priced === 0) return formatCost({ amount: 0, priced: false });
  const label = formatCost({ amount, priced: true });
  return unpriced > 0 ? `${label} (partial)` : label;
}

function cacheLostLabel(summary: FailuresReport["summary"]): string {
  if (summary.cacheLostTokens === 0) return formatCost({ amount: 0, priced: true });
  if (summary.cacheLostExtraAmount === 0 && summary.cacheLostUnpriced > 0) return formatCost({ amount: 0, priced: false });
  const amount = `+${formatCost({ amount: summary.cacheLostExtraAmount, priced: true })}`;
  return summary.cacheLostUnpriced > 0 ? `${amount} (partial)` : amount;
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "warning" }) {
  return (
    <Card className={`gap-2 py-4 ${tone === "warning" ? "border-warning/50 bg-warning/5" : ""}`}>
      <CardHeader className="px-4"><CardDescription>{label}</CardDescription><CardTitle className="font-mono text-2xl">{value}</CardTitle></CardHeader>
      <CardContent className="px-4 text-xs text-muted-foreground">{hint}</CardContent>
    </Card>
  );
}

function FailureSummary({ report }: { report: FailuresReport }) {
  const { summary } = report;
  const providerIncidents = report.incidents.filter((incident) => incident.providerFault);
  const recoveredProvider = providerIncidents.filter((incident) => incident.recovery !== null).length;
  const pricedResends = recoveredProvider - summary.resendUnpriced;
  return (
    <section aria-label="Failure totals" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      <Stat label="Failed model calls" value={formatNumber(summary.failedCalls)} hint={`${formatNumber(summary.byKind["rate-limit"])} rate-limited · ${formatNumber(summary.byKind["provider-down"])} provider down · ${formatNumber(summary.byKind.aborted)} cancelled by you · ${formatNumber(summary.hiddenRetries)} retries opencode made inside steps`} />
      <Stat label="Resends after a failure" value={formatNumber(summary.autoResends + summary.userResends)} hint={`${formatNumber(summary.autoResends)} automatic by opencode · ${formatNumber(summary.userResends)} by you. Retries inside a single call are not saved by opencode.`} />
      <Stat
        label="Cache lost to failures"
        value={formatNumber(summary.cacheLostTokens)}
        tone={summary.cacheLostTokens > 0 ? "warning" : undefined}
        hint={`Tokens of context paid at full input price instead of cache price on the replay: ${cacheLostLabel(summary)}. ${formatNumber(summary.repeatedCalls)} tool call${summary.repeatedCalls === 1 ? "" : "s"} redone after a failure. The replays sent ${formatNumber(tokenTotal(summary.resendTokens))} tokens in all (${resendCostLabel(summary.resendCostAmount, summary.resendUnpriced, pricedResends)}), most of which the original call would have paid anyway.`}
      />
      <Stat
        label="Accepted, never recorded"
        value={summary.acceptedUnrecordedRequests > 0 ? `≈${formatNumber(summary.acceptedUnrecordedTokens)}` : "0"}
        tone={summary.acceptedUnrecordedRequests > 0 ? "warning" : undefined}
        hint={summary.acceptedUnrecordedRequests > 0
          ? `Estimated tokens in ${formatNumber(summary.acceptedUnrecordedRequests)} request${summary.acceptedUnrecordedRequests === 1 ? "" : "s"} the provider accepted (HTTP 2xx) that broke mid-response, with no usage recorded by opencode — the likeliest charges you cannot see. Sized from the context of the step before each.`
          : "No request the provider accepted (HTTP 2xx) went without recorded usage."}
      />
      <Stat
        label="Usage recorded on failed calls"
        value={formatNumber(tokenTotal(summary.failedCallTokens))}
        tone={summary.failedCallsWithUsage > 0 ? "warning" : undefined}
        hint={summary.failedCallsWithUsage > 0 ? `${formatNumber(summary.failedCallsWithUsage)} failed call${summary.failedCallsWithUsage === 1 ? "" : "s"} still reported usage — tokens the provider may have charged for a response you never got.` : "No failed call reported any usage."}
      />
    </section>
  );
}

function IncidentRow({ incident }: { incident: FailureIncident }) {
  const kinds = [...new Set(incident.failures.map((call) => call.kind))];
  const recovery = incident.recovery;
  return (
    <details className="group border-b border-border last:border-b-0">
      <summary className="grid cursor-pointer list-none grid-cols-[auto_1fr] gap-x-2 gap-y-1 px-4 py-3 text-sm md:grid-cols-[auto_minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)] md:items-center [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        <div className="min-w-0">
          <Link href={`/sessions/${encodeURIComponent(incident.sessionId)}`} className="block truncate font-medium hover:underline" onClick={(event) => event.stopPropagation()}>{incident.sessionTitle}</Link>
          <time suppressHydrationWarning className="text-xs text-muted-foreground" dateTime={new Date(incident.firstFailureAt).toISOString()}>{new Date(incident.firstFailureAt).toLocaleString()}</time>
        </div>
        <div className="col-start-2 flex flex-wrap gap-1 md:col-start-auto">
          {kinds.map((kind) => <Badge key={kind} variant={kind === "aborted" ? "outline" : "secondary"}>{KIND_LABELS[kind]}</Badge>)}
          <span className="text-xs text-muted-foreground">× {incident.failures.length}</span>
        </div>
        <p className="col-start-2 text-xs text-muted-foreground md:col-start-auto">{incident.autoResends} auto · {incident.userResends} by you</p>
        <div className="col-start-2 md:col-start-auto md:text-right">
          {recovery ? <>
            <p className="font-mono">{formatNumber(incident.cacheLost?.tokens ?? 0)} cache lost</p>
            <p className="text-xs text-muted-foreground">{incident.repeatedCalls.length} redone · recovered after {formatDuration(recovery.timeCreated - incident.firstFailureAt)}</p>
          </> : <p className="text-xs text-muted-foreground">Never recovered</p>}
        </div>
      </summary>
      <div className="space-y-3 bg-muted/20 px-4 py-3 text-sm">
        {recovery ? <p className="text-xs text-muted-foreground">The step that succeeded afterwards sent {formatNumber(recovery.tokens.input)} input tokens ({formatNumber(recovery.tokens.cacheRead)} read from cache) and received {formatNumber(recovery.tokens.output)} output tokens{recovery.modelID ? ` on ${recovery.providerID ?? "?"}/${recovery.modelID}` : ""}. {incident.cacheLost && incident.cacheLost.tokens > 0 ? ` The step before the failure read ${formatNumber(incident.before?.tokens.cacheRead ?? 0)} from cache, so ${formatNumber(incident.cacheLost.tokens)} tokens were paid at the full input price instead (${incident.cacheLost.extraCost.priced ? `+${formatCost(incident.cacheLost.extraCost)}` : "not priced"}).` : ""}{incident.repeatedCalls.length > 0 ? ` ${incident.repeatedCalls.length} tool call${incident.repeatedCalls.length === 1 ? " was" : "s were"} redone after the resend.` : ""}</p> : null}
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground"><tr><th className="py-1 pr-3 font-medium">When</th><th className="py-1 pr-3 font-medium">Failure</th><th className="py-1 pr-3 font-medium">HTTP</th><th className="py-1 pr-3 font-medium">Model</th><th className="py-1 pr-3 text-right font-medium">Usage recorded</th><th className="py-1 font-medium">Provider message</th></tr></thead>
          <tbody>{incident.failures.map((call) => (
            <tr key={call.messageId} className="align-top">
              <td className="py-1 pr-3 whitespace-nowrap"><time suppressHydrationWarning dateTime={new Date(call.timeCreated).toISOString()}>{new Date(call.timeCreated).toLocaleTimeString()}</time></td>
              <td className="py-1 pr-3">{KIND_LABELS[call.kind]} <span className="font-mono text-muted-foreground">({call.rawType})</span></td>
              <td className="py-1 pr-3 font-mono">{call.status ?? "—"}</td>
              <td className="py-1 pr-3 font-mono">{call.modelID ? `${call.providerID ?? "?"}/${call.modelID}` : "—"}</td>
              <td className={`py-1 pr-3 text-right font-mono ${call.tokens ? "text-warning" : ""}`}>{call.tokens ? formatNumber(tokenTotal(call.tokens)) : "none"}</td>
              <td className="max-w-md py-1 break-words text-muted-foreground">{call.message ?? "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </details>
  );
}

export function FailureReport({ report }: { report: FailuresReport }) {
  const incidents = useClientPaging([...report.incidents].sort((left, right) => right.firstFailureAt - left.firstFailureAt), 10);
  const series = FAILURE_KINDS.filter((kind) => report.summary.byKind[kind] > 0).map((kind) => ({ key: kind, label: KIND_LABELS[kind] }));
  return (
    <div className="space-y-5">
      <FailureSummary report={report} />
      <Card><CardContent><BarChartCard title="Failed calls per day" data={report.byDay} xKey="date" xLabel="Date" series={series} stacked emptyMessage="No failed model calls in this range." /></CardContent></Card>
      <details open className="group overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <summary className="flex cursor-pointer list-none items-start gap-2 p-4 [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <div><h2 className="font-semibold">Failure incidents</h2><p className="mt-1 text-xs text-muted-foreground">Each incident runs from a failed call to the next step that succeeded, with the resends in between. Expand one to see every failed call and what the recovery paid.</p></div>
        </summary>
        {report.incidents.length === 0
          ? <p className="border-t border-border p-4 text-sm text-muted-foreground">No failed model calls in this range.</p>
          : <div className="border-t border-border">{incidents.visible.map((incident) => <IncidentRow key={`${incident.sessionId}-${incident.firstFailureAt}`} incident={incident} />)}<div className="border-t border-border p-4"><TablePager noun={["incident", "incidents"]} {...incidents.pagerProps} /></div></div>}
      </details>
    </div>
  );
}
