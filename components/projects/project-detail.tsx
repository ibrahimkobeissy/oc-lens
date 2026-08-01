"use client";

import { FolderKanban, GitBranch, MessagesSquare } from "lucide-react";
import Link from "next/link";

import { BreakdownDonut, collapseBreakdownSlices, type BreakdownSlice } from "@/components/overview/model-breakdown-donut";
import { UsageOverTimeChart } from "@/components/overview/usage-over-time-chart";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { formatCost, formatDuration, formatNumber, formatTokens } from "@/lib/format";
import type { ModelUsage, OcTokens, ProjectDetail as ProjectDetailData, SessionSummary } from "@/types/oc";

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function zeroTokens(): OcTokens {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

function addTokens(target: OcTokens, source: OcTokens): void {
  target.input += source.input;
  target.output += source.output;
  target.reasoning += source.reasoning;
  target.cacheRead += source.cacheRead;
  target.cacheWrite += source.cacheWrite;
}

function totalTokens(tokens: OcTokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite;
}

export function projectDailyTokens(sessions: readonly SessionSummary[], timeZone = "UTC"): Array<{ date: string; tokens: OcTokens }> {
  const days = new Map<string, OcTokens>();
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  for (const session of sessions) {
    if (!Number.isFinite(session.timeCreated)) continue;
    const dateValue = new Date(session.timeCreated);
    if (Number.isNaN(dateValue.getTime())) continue;
    const parts = formatter.formatToParts(dateValue);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
    const date = `${part("year")}-${part("month")}-${part("day")}`;
    const tokens = days.get(date) ?? zeroTokens();
    addTokens(tokens, session.tokens);
    days.set(date, tokens);
  }
  return [...days].sort(([left], [right]) => left.localeCompare(right)).map(([date, tokens]) => ({ date, tokens }));
}

export function projectModelSlices(models: readonly ModelUsage[]): BreakdownSlice[] {
  return collapseBreakdownSlices(models.map((model) => {
    const key = model.providerID === "unknown" || model.modelID === "unknown" ? "unknown" : `${model.providerID}/${model.modelID}`;
    return { key, label: key, value: model.messageCount };
  }));
}

export function projectSessions(sessions: readonly SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((left, right) => right.timeCreated - left.timeCreated || left.id.localeCompare(right.id));
}

function EventTime({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <span>Time unavailable</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span>Time unavailable</span>;
  const iso = date.toISOString();
  return <time dateTime={iso} title={iso}>{dateTimeFormatter.format(date)} UTC</time>;
}

function MetricCard({ label, value, muted = false }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return <Card className="gap-2 py-4"><CardContent className="px-4"><dl><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`mt-1 font-mono text-xl ${muted ? "text-muted-foreground" : ""}`}>{value}</dd></dl></CardContent></Card>;
}

function ProjectSessions({ sessions }: { sessions: readonly SessionSummary[] }) {
  const rows = projectSessions(sessions);
  return (
    <section aria-labelledby="project-sessions-title" className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 id="project-sessions-title" className="font-semibold">Sessions</h2>
          <p className="mt-1 text-xs text-muted-foreground">Every session returned for this project, newest first.</p>
        </div>
        <MessagesSquare aria-hidden="true" className="size-5 text-muted-foreground" />
      </header>
      {rows.length === 0 ? (
        <div className="p-4"><EmptyState icon={<MessagesSquare aria-hidden="true" />} title="No sessions recorded" description="This project exists, but it has no session history yet." /></div>
      ) : (
        <div className="max-w-full overflow-x-auto">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
              <tr><th className="min-w-72 px-3 py-2 font-medium">Session</th><th className="px-3 py-2 font-medium">Agent</th><th className="px-3 py-2 font-medium">Model</th><th className="px-3 py-2 font-medium">Started</th><th className="px-3 py-2 font-medium">Duration</th><th className="px-3 py-2 text-right font-medium">Messages</th><th className="px-3 py-2 text-right font-medium">Tokens</th><th className="px-3 py-2 text-right font-medium">Cost</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((session) => {
                const messages = session.messageCounts.user + session.messageCounts.assistant;
                return (
                  <tr key={session.id} className="transition-colors hover:bg-muted/40">
                    <td className="max-w-80 px-3 py-3"><Link href={`/sessions/${encodeURIComponent(session.id)}`} title={session.title} className="block truncate font-medium text-foreground hover:text-primary hover:underline">{session.title}</Link><span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground" title={session.slug}>{session.slug}</span></td>
                    <td className="whitespace-nowrap px-3 py-3">{session.agent ?? "unknown"}</td>
                    <td className="whitespace-nowrap px-3 py-3">{session.model ? <span title={session.model.providerID}>{session.model.id}</span> : "unknown"}</td>
                    <td className="whitespace-nowrap px-3 py-3"><EventTime value={session.timeCreated} /></td>
                    <td className="whitespace-nowrap px-3 py-3">{formatDuration(session.durationMs)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right" title={`${session.messageCounts.user} user, ${session.messageCounts.assistant} assistant`}>{formatNumber(messages)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right">{formatTokens(totalTokens(session.tokens))}</td>
                    <td className={`whitespace-nowrap px-3 py-3 text-right ${session.cost.priced ? "" : "text-muted-foreground"}`}>{formatCost(session.cost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ProjectDetail({ project, timeZone }: { project: ProjectDetailData; timeZone: string }) {
  const activityTokens = projectDailyTokens(project.sessions, timeZone);
  const modelSlices = projectModelSlices(project.modelBreakdown);
  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink asChild><Link href="/projects">Projects</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{project.displayName}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <header className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted"><FolderKanban aria-hidden="true" className="size-5" /></span>
          <div className="min-w-0"><h1 className="truncate text-2xl font-semibold tracking-tight" title={project.displayName}>{project.displayName}</h1><p className="font-mono text-xs text-muted-foreground">{project.id}</p></div>
        </div>
        <p dir="rtl" title={project.worktree} className="overflow-hidden text-ellipsis whitespace-nowrap text-left font-mono text-xs text-muted-foreground">{project.worktree}</p>
        {project.branches && project.branches.length > 0 ? <div className="flex flex-wrap gap-2" aria-label="Project branches">{project.branches.map((branch) => <Badge key={branch} variant="outline"><GitBranch aria-hidden="true" />{branch}</Badge>)}</div> : null}
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Sessions" value={formatNumber(project.sessionCount)} />
        <MetricCard label="Messages" value={formatNumber(project.messageCount)} />
        <MetricCard label="Tokens" value={formatTokens(totalTokens(project.tokens))} />
        <MetricCard label="Estimated cost" value={formatCost(project.cost)} muted={!project.cost.priced} />
        <MetricCard label="Last active" value={<span className="text-sm"><EventTime value={project.lastActivity} /></span>} />
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <UsageOverTimeChart activity={project.dailyActivity} dailyTokens={activityTokens} />
        <BreakdownDonut title="Model breakdown" slices={modelSlices} valueLabel="messages" emptyMessage="No message model data is available for this project." />
      </div>

      <ProjectSessions sessions={project.sessions} />
    </div>
  );
}
