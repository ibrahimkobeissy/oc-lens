"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { BarChartCard } from "@/components/charts/bar-chart-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCost, formatDuration, formatNumber } from "@/lib/format";
import { FAILURE_KINDS, type FailureIncident, type FailureKind, type FailuresReport } from "@/lib/audit/failure-types";
import type { OcTokens } from "@/types/oc";

export const KIND_LABELS: Record<FailureKind, string> = {
  "rate-limit": "Rate limit (TPM/RPM)",
  "provider-down": "Provider down (5xx)",
  auth: "Auth rejected",
  "invalid-request": "Invalid request",
  "provider-error": "Provider error",
  aborted: "Cancelled by you",
  unknown: "Unknown",
};

function tokenTotal(tokens: OcTokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite;
}

/** Same honesty rule as the daily tables: a partial sum is labelled, nothing priced reads "not priced". */
export function resendCostLabel(amount: number, unpriced: number, priced: number): string {
  if (priced === 0) return formatCost({ amount: 0, priced: false });
  const label = formatCost({ amount, priced: true });
  return unpriced > 0 ? `${label} (partial)` : label;
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
    <section aria-label="Failure totals" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Failed model calls" value={formatNumber(summary.failedCalls)} hint={`${formatNumber(summary.byKind["rate-limit"])} rate-limited · ${formatNumber(summary.byKind["provider-down"])} provider down · ${formatNumber(summary.byKind.aborted)} cancelled by you`} />
      <Stat label="Resends after a failure" value={formatNumber(summary.autoResends + summary.userResends)} hint={`${formatNumber(summary.autoResends)} automatic by opencode · ${formatNumber(summary.userResends)} by you. Retries inside a single call are not saved by opencode.`} />
      <Stat label="Tokens paid by resends" value={formatNumber(tokenTotal(summary.resendTokens))} hint={`${resendCostLabel(summary.resendCostAmount, summary.resendUnpriced, pricedResends)} across ${formatNumber(recoveredProvider)} recovered incident${recoveredProvider === 1 ? "" : "s"}. Upper bound: the original call would have paid most of this context too.`} />
      <Stat
        label="Usage recorded on failed calls"
        value={formatNumber(tokenTotal(summary.failedCallTokens))}
        tone={summary.failedCallsWithUsage > 0 ? "warning" : undefined}
        hint={summary.failedCallsWithUsage > 0 ? `${formatNumber(summary.failedCallsWithUsage)} failed call${summary.failedCallsWithUsage === 1 ? "" : "s"} still reported usage — tokens the provider may have charged for a response you never got.` : "No failed call reported any usage. Whether the provider charged them anyway only shows on your bill — compare it below."}
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
            <p className="font-mono">{formatNumber(tokenTotal(recovery.tokens))} tokens</p>
            <p className="text-xs text-muted-foreground">{formatCost(recovery.cost)} · recovered after {formatDuration(recovery.timeCreated - incident.firstFailureAt)}</p>
          </> : <p className="text-xs text-muted-foreground">Never recovered</p>}
        </div>
      </summary>
      <div className="space-y-3 bg-muted/20 px-4 py-3 text-sm">
        {recovery ? <p className="text-xs text-muted-foreground">The step that succeeded afterwards sent {formatNumber(recovery.tokens.input)} input tokens ({formatNumber(recovery.tokens.cacheRead)} read from cache) and received {formatNumber(recovery.tokens.output)} output tokens{recovery.modelID ? ` on ${recovery.providerID ?? "?"}/${recovery.modelID}` : ""}. A resend pays the whole conversation context again; little cache reuse means it paid close to full price.</p> : null}
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
          : <div className="border-t border-border">{report.incidents.map((incident) => <IncidentRow key={`${incident.sessionId}-${incident.firstFailureAt}`} incident={incident} />)}</div>}
      </details>
    </div>
  );
}
