"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";

import { SessionBadges } from "@/components/sessions/session-badges";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePager } from "@/components/ui/table-pager";
import { formatCost, formatDuration, formatNumber, formatTokens } from "@/lib/format";
import type { SessionSummary } from "@/types/oc";

export type SessionSort = "timeCreated" | "timeUpdated" | "timeArchived" | "durationMs" | "messages" | "userMessages" | "assistantMessages" | "toolCallCount" | "tokens" | "inputTokens" | "outputTokens" | "reasoningTokens" | "cacheReadTokens" | "cacheWriteTokens" | "cost";
export type SortOrder = "asc" | "desc";

interface SessionTableProps {
  sessions: SessionSummary[];
  totalCount: number;
  page: number;
  sort: SessionSort;
  order: SortOrder;
  pageSize: number;
  onPageSize: (size: number) => void;
  canPrevious: boolean;
  canNext: boolean;
  onSort: (sort: SessionSort) => void;
  onPrevious: () => void;
  onNext: () => void;
}

export function sessionTotalTokens(session: SessionSummary): number {
  return session.tokens.input + session.tokens.output + session.tokens.reasoning + session.tokens.cacheRead + session.tokens.cacheWrite;
}

function SortButton({ label, column, active, order, onSort }: { label: string; column: SessionSort; active: boolean; order: SortOrder; onSort: (sort: SessionSort) => void }) {
  const Icon = !active ? ArrowUpDown : order === "asc" ? ArrowUp : ArrowDown;
  return <button type="button" className="inline-flex items-center gap-1 hover:text-primary" onClick={() => onSort(column)}>{label}<Icon aria-hidden="true" className="size-3.5" /><span className="sr-only">Sort by {label}</span></button>;
}

export function SessionTable(props: SessionTableProps) {
  const { sessions, totalCount, page, pageSize, onPageSize, sort, order, canPrevious, canNext, onSort, onPrevious, onNext } = props;
  const sortable = (label: string, column: SessionSort) => <SortButton label={label} column={column} active={sort === column} order={order} onSort={onSort} />;
  return (
    <section className="space-y-3" aria-label="Sessions table and pagination">
      <div className="max-w-full overflow-x-auto rounded-lg border border-border bg-card shadow-xs" data-testid="session-table-scroll-container">
        <Table className="min-w-[1120px]">
          <TableHeader><TableRow>
            <TableHead className="min-w-72">Session</TableHead>
            <TableHead>{sortable("Date", "timeCreated")}</TableHead>
            <TableHead>Project</TableHead><TableHead>Agent</TableHead><TableHead>Model</TableHead>
            <TableHead>{sortable("Duration", "durationMs")}</TableHead>
            <TableHead>{sortable("Messages", "messages")}</TableHead>
            <TableHead>{sortable("Tools", "toolCallCount")}</TableHead>
            <TableHead>{sortable("Tokens", "tokens")}</TableHead>
            <TableHead>{sortable("Cost", "cost")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{sessions.map((session) => {
            const messages = session.messageCounts.user + session.messageCounts.assistant;
            return <TableRow key={session.id}>
              <TableCell className="max-w-80"><div className="space-y-1.5"><Link className="block truncate font-medium text-foreground hover:text-primary hover:underline" href={`/sessions/${encodeURIComponent(session.id)}`} title={session.title}>{session.title}</Link><p className="truncate font-mono text-xs text-muted-foreground">{session.slug}</p><SessionBadges session={session} /></div></TableCell>
              <TableCell><time suppressHydrationWarning dateTime={new Date(session.timeCreated).toISOString()}>{new Date(session.timeCreated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time></TableCell>
              <TableCell>{session.projectDisplayName}</TableCell>
              <TableCell>{session.agent ?? "unknown"}</TableCell>
              <TableCell>{session.model ? <span title={session.model.providerID}>{session.model.id}</span> : "unknown"}</TableCell>
              <TableCell>{formatDuration(session.durationMs)}</TableCell>
              <TableCell title={`${session.messageCounts.user} user, ${session.messageCounts.assistant} assistant`}>{formatNumber(messages)}</TableCell>
              <TableCell>{formatNumber(session.toolCallCount)}</TableCell>
              <TableCell>{formatTokens(sessionTotalTokens(session))}</TableCell>
              <TableCell className={session.cost.priced ? "" : "text-muted-foreground"}>{formatCost(session.cost)}</TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
      </div>
      <TablePager total={totalCount} noun={["matching session", "matching sessions"]} page={page} pageSize={pageSize} onPageSize={onPageSize} canPrevious={canPrevious} canNext={canNext} onPrevious={onPrevious} onNext={onNext} previousHint={<kbd className="font-mono text-xs">[</kbd>} nextHint={<kbd className="font-mono text-xs">]</kbd>} />
    </section>
  );
}
