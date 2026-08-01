import Link from "next/link";
import { ArrowRightLeft, Clock3 } from "lucide-react";

import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import type { AgentSwitchEvent } from "@/types/oc";

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

function EventTime({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <span>Time unavailable</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span>Time unavailable</span>;
  return <time dateTime={date.toISOString()} title={date.toISOString()}>{dateFormatter.format(date)} UTC</time>;
}

export function AgentSwitchTimeline({ events }: { events: AgentSwitchEvent[] }) {
  if (events.length === 0) {
    return <EmptyState icon={<ArrowRightLeft aria-hidden="true" />} title="No agent switches recorded" description="No agent-switched lifecycle rows exist for this history." />;
  }

  return (
    <section aria-labelledby="agent-switches-title" className="rounded-lg border border-border bg-card p-4">
      <h2 id="agent-switches-title" className="text-sm font-medium">Agent-switch timeline</h2>
      <p className="mt-1 text-xs text-muted-foreground">Recorded <code className="font-mono text-foreground">session_message</code> lifecycle events, ordered by sequence.</p>
      <ol className="mt-4 space-y-3">
        {events.map((event) => (
          <li key={event.seq} className="grid gap-2 rounded-md border border-border p-3 text-sm sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <span className="font-mono text-xs text-muted-foreground">#{event.seq}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2"><ArrowRightLeft aria-hidden="true" className="size-4 text-muted-foreground" /><Badge variant={event.agent === "unknown" ? "outline" : "secondary"} className="font-mono">{event.agent}</Badge></div>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 aria-hidden="true" className="size-3" /><EventTime value={event.timeCreated} /></p>
            </div>
            {event.sessionId ? <Link className="font-mono text-xs text-primary hover:underline" href={`/sessions/${encodeURIComponent(event.sessionId)}`}>{event.sessionId}</Link> : <span className="text-xs text-muted-foreground">Session unavailable</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
