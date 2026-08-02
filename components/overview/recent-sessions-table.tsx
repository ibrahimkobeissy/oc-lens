"use client";

import { useState } from "react";
import { ArrowRight, MessagesSquare } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/states/empty-state";
import { formatCost, formatDuration, formatNumber, formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SessionSummary } from "@/types/oc";

const RECENT_LIMIT = 10;
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

const RECENCY_FILTERS = [
  { key: "24h", label: "Active (24h)", windowMs: 24 * HOUR_MS },
  { key: "7d", label: "Recent (7d)", windowMs: 7 * DAY_MS },
  { key: "all", label: "All", windowMs: null },
] as const;
type RecencyFilterKey = (typeof RECENCY_FILTERS)[number]["key"];

export function recentSessions(sessions: readonly SessionSummary[]): SessionSummary[] {
  return [...sessions]
    .sort((left, right) => right.timeCreated - left.timeCreated || left.id.localeCompare(right.id))
    .slice(0, RECENT_LIMIT);
}

/** Exported for direct testing without depending on `Date.now()`. */
export function filterSessionsByRecency(sessions: readonly SessionSummary[], filter: RecencyFilterKey, now: number): SessionSummary[] {
  const windowMs = RECENCY_FILTERS.find((entry) => entry.key === filter)?.windowMs;
  if (windowMs === null || windowMs === undefined) return [...sessions];
  return sessions.filter((session) => now - session.timeCreated <= windowMs);
}

function tokenTotal(session: SessionSummary): number {
  return session.tokens.input + session.tokens.output + session.tokens.reasoning + session.tokens.cacheRead + session.tokens.cacheWrite;
}

export function RecentSessionsTable({ sessions, initialFilter = "7d" }: { sessions: readonly SessionSummary[]; initialFilter?: RecencyFilterKey }) {
  const [filter, setFilter] = useState<RecencyFilterKey>(initialFilter);
  const [now] = useState(() => Date.now());
  const rows = recentSessions(filterSessionsByRecency(sessions, filter, now));
  return (
    <section aria-labelledby="recent-sessions-heading" className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div><h2 id="recent-sessions-heading" className="font-semibold text-card-foreground">Recent sessions</h2><p className="mt-1 text-xs text-muted-foreground">The ten latest sessions in the selected overview range.</p></div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Filter recent sessions by recency" className="flex items-center gap-0.5 rounded-md border border-border bg-muted/30 p-0.5">
            {RECENCY_FILTERS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                aria-pressed={filter === entry.key}
                onClick={() => setFilter(entry.key)}
                className={cn(
                  "rounded px-2 py-1 text-xs font-medium transition-colors",
                  filter === entry.key ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground"><MessagesSquare aria-hidden="true" className="size-4" /></span>
        </div>
      </header>
      {rows.length === 0 ? (
        <div className="p-4"><EmptyState icon={<MessagesSquare />} title="No sessions in this range" description="Choose a wider range or start an opencode session." /></div>
      ) : (
        <div className="max-w-full overflow-x-auto" data-testid="recent-sessions-scroll-container">
          <table className="min-w-[1040px] w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="min-w-72 px-3 py-2 font-medium">Session</th><th className="px-3 py-2 font-medium">Project</th><th className="px-3 py-2 font-medium">Agent</th><th className="px-3 py-2 font-medium">Model</th><th className="px-3 py-2 font-medium">When</th><th className="px-3 py-2 font-medium">Duration</th><th className="px-3 py-2 text-right font-medium">Messages</th><th className="px-3 py-2 text-right font-medium">Tokens</th><th className="px-3 py-2 text-right font-medium">Cost</th></tr></thead>
            <tbody className="divide-y divide-border">{rows.map((session) => {
              const messages = session.messageCounts.user + session.messageCounts.assistant;
              return <tr key={session.id} className="transition-colors hover:bg-muted/40">
                <td className="max-w-80 px-3 py-3"><Link href={`/sessions/${encodeURIComponent(session.id)}`} title={session.title} className="block truncate font-medium text-foreground hover:text-primary hover:underline">{session.title}</Link><span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground" title={session.slug}>{session.slug}</span></td>
                <td className="whitespace-nowrap px-3 py-3">{session.projectDisplayName}</td>
                <td className="whitespace-nowrap px-3 py-3">{session.agent ?? "unknown"}</td>
                <td className="whitespace-nowrap px-3 py-3">{session.model ? <span title={session.model.providerID}>{session.model.id}</span> : "unknown"}</td>
                <td className="whitespace-nowrap px-3 py-3"><time suppressHydrationWarning dateTime={new Date(session.timeCreated).toISOString()} title={new Date(session.timeCreated).toLocaleString()}>{new Date(session.timeCreated).toLocaleDateString(undefined, { dateStyle: "medium" })}</time></td>
                <td className="whitespace-nowrap px-3 py-3">{formatDuration(session.durationMs)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right" title={`${session.messageCounts.user} user, ${session.messageCounts.assistant} assistant`}>{formatNumber(messages)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right">{formatTokens(tokenTotal(session))}</td>
                <td className={`whitespace-nowrap px-3 py-3 text-right ${session.cost.priced ? "" : "text-muted-foreground"}`}>{formatCost(session.cost)}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
      <footer className="flex justify-center border-t border-border p-2"><Link href="/sessions" className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">View all sessions<ArrowRight aria-hidden="true" className="size-3.5" /></Link></footer>
    </section>
  );
}
