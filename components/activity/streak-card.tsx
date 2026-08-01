import { CalendarDays, Flame, History, Star, Trophy } from "lucide-react";

import { EmptyState } from "@/components/states/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { StreakSummary } from "@/types/oc";

interface StreakCardProps {
  streaks: StreakSummary;
  locale?: string;
}

function formatDate(date: string | null, locale: string): string {
  if (date === null) return "Not available";
  const [year, month, day] = date.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return date;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatRange(start: string | null, end: string | null, locale: string): string {
  if (start === null || end === null) return "No streak recorded";
  const formattedStart = formatDate(start, locale);
  const formattedEnd = formatDate(end, locale);
  return start === end ? formattedStart : `${formattedStart} – ${formattedEnd}`;
}

function Stat({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Flame;
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background/40 p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span>{label}</span>
      </div>
      <p className="mt-2 break-words text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export function StreakCard({ streaks, locale = "en-US" }: StreakCardProps) {
  const hasActivity = streaks.totalActiveDays > 0;
  const currentDetail = streaks.currentStreakDays > 0
    ? "Consecutive active days ending today"
    : hasActivity
      ? "No active streak today"
      : "No active days recorded";

  return (
    <Card>
      <section aria-label="Activity streak summary">
        <CardHeader>
          <CardTitle>Streaks and active days</CardTitle>
          <CardDescription>Consistency and milestones for the selected activity range.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Stat icon={Flame} label="Current streak" value={streaks.currentStreakDays} detail={currentDetail} />
            <Stat
              icon={Trophy}
              label="Longest streak"
              value={streaks.longestStreakDays}
              detail={formatRange(streaks.longestStreakStart, streaks.longestStreakEnd, locale)}
            />
            <Stat icon={CalendarDays} label="Active days" value={streaks.totalActiveDays} detail="Days with at least one session" />
            <Stat icon={Star} label="Most active day" value={formatDate(streaks.mostActiveDay, locale)} detail="Highest combined session and event activity" />
            <Stat icon={History} label="First session" value={formatDate(streaks.firstSessionDate, locale)} detail="Earliest session in this range" />
          </div>

          {!hasActivity && (
            <EmptyState
              icon={<CalendarDays aria-hidden="true" />}
              title="No activity yet"
              description="Streaks will appear after an opencode session is recorded in this range."
            />
          )}
        </CardContent>
      </section>
    </Card>
  );
}
