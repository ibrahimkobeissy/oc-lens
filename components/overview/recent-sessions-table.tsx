import { ArrowRight, MessagesSquare } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/states/empty-state";
import { formatCost, formatDuration, formatNumber, formatTokens } from "@/lib/format";
import type { SessionSummary } from "@/types/oc";

const RECENT_LIMIT = 10;

export function recentSessions(sessions: readonly SessionSummary[]): SessionSummary[] {
  return [...sessions]
    .sort((left, right) => right.timeCreated - left.timeCreated || left.id.localeCompare(right.id))
    .slice(0, RECENT_LIMIT);
}

function tokenTotal(session: SessionSummary): number {
  return session.tokens.input + session.tokens.output + session.tokens.reasoning + session.tokens.cacheRead + session.tokens.cacheWrite;
}

export function RecentSessionsTable({ sessions }: { sessions: readonly SessionSummary[] }) {
  const rows = recentSessions(sessions);
  return (
    <section aria-labelledby="recent-sessions-heading" className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
      <header className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div><h2 id="recent-sessions-heading" className="font-semibold text-card-foreground">Recent sessions</h2><p className="mt-1 text-xs text-muted-foreground">The ten latest sessions in the selected overview range.</p></div>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground"><MessagesSquare aria-hidden="true" className="size-4" /></span>
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
