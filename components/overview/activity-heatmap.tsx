"use client";

import { useRouter } from "next/navigation";

import { HeatmapGrid, type HeatmapCell } from "@/components/charts/heatmap-grid";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DailyActivity } from "@/types/oc";

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function localDate(epochMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(epochMs);
  const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function buildHeatmapWeeks(activity: readonly DailyActivity[], today: string): HeatmapCell[][] {
  const totals = new Map(activity.map((day) => [day.date, day.sessionCount + day.messageCount + day.toolCallCount]));
  const first = addDays(today, -364);
  const cells: HeatmapCell[] = Array.from({ length: weekday(first) }, () => ({ label: "Outside rolling year", value: null }));
  for (let offset = 0; offset < 365; offset += 1) {
    const date = addDays(first, offset);
    cells.push({ label: date, value: totals.get(date) ?? 0 });
  }
  while (cells.length % 7 !== 0) cells.push({ label: "Outside rolling year", value: null });
  const weeks: HeatmapCell[][] = [];
  for (let offset = 0; offset < cells.length; offset += 7) weeks.push(cells.slice(offset, offset + 7));
  return weeks;
}

const WEEKDAY_ROW_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""] as const;
const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

/** One label per week column: the month name on the first week that starts a new month, blank otherwise — so a 53-column year reads like a calendar instead of a wall of dots. */
export function buildHeatmapColumnLabels(weeks: readonly HeatmapCell[][]): Array<string | null> {
  let previousMonth: number | null = null;
  return weeks.map((week) => {
    const dated = week.find((cell) => cell.value !== null && /^\d{4}-\d{2}-\d{2}$/.test(cell.label));
    if (!dated) return null;
    const month = new Date(`${dated.label}T12:00:00Z`).getUTCMonth();
    if (month === previousMonth) return null;
    previousMonth = month;
    return MONTH_LABEL_FORMATTER.format(new Date(`${dated.label}T12:00:00Z`));
  });
}

export function sessionHrefForDate(date: string): string {
  const from = new Date(`${date}T00:00:00`);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  const params = new URLSearchParams({ from: `${from.getTime()}`, to: `${to.getTime()}` });
  return `/sessions?${params.toString()}`;
}

export function ActivityHeatmap({ activity, timeZone, now }: { activity: DailyActivity[]; timeZone: string; now: number }) {
  const router = useRouter();
  const hasActivity = activity.some((day) => day.sessionCount + day.messageCount + day.toolCallCount > 0);
  const weeks = hasActivity ? buildHeatmapWeeks(activity, localDate(now, timeZone)) : [];
  return (
    <Card className="min-w-0">
      <CardHeader><CardTitle>Activity heatmap</CardTitle><CardDescription>A rolling year of local activity. Select a day to inspect its sessions.</CardDescription></CardHeader>
      <CardContent>
        <HeatmapGrid
          weeks={weeks}
          columnLabels={buildHeatmapColumnLabels(weeks)}
          rowLabels={WEEKDAY_ROW_LABELS}
          emptyMessage="No activity was recorded in the rolling year."
          onCellClick={(cell) => {
            if (cell.value !== null && /^\d{4}-\d{2}-\d{2}$/.test(cell.label)) router.push(sessionHrefForDate(cell.label));
          }}
        />
      </CardContent>
    </Card>
  );
}
