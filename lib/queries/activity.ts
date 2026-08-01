import type { DatabaseSync } from "node:sqlite";
import { query } from "@/lib/db/connection";
import { decodePartData } from "@/lib/decode/part";
import { mergeWarnings } from "@/lib/decode/warnings";
import type { DailyActivity, DayOfWeekBucket, HourBucket, OcTokens, OcWarning, StreakSummary } from "@/types/oc";
import type { QueryResult } from "./sessions";

export interface TimeRange { from?: number; to?: number; timeZone?: string; projectId?: string }
interface TimedRow { session_id: string; time_created: number }
interface SessionTimeRow { id: string; time_created: number }
interface PartTimeRow { session_id: string; time_created: number; data: string | null }
interface TokenRow extends SessionTimeRow { tokens_input: number; tokens_output: number; tokens_reasoning: number; tokens_cache_read: number; tokens_cache_write: number }

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const hourFormatters = new Map<string, Intl.DateTimeFormat>();

function zone(range: TimeRange): string {
  const value = range.timeZone ?? "UTC";
  new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
  return value;
}

export function localDay(epochMs: number, timeZone: string): string {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }); dayFormatters.set(timeZone, formatter); }
  const parts = formatter.formatToParts(epochMs);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function localHour(epochMs: number, timeZone: string): number {
  let formatter = hourFormatters.get(timeZone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }); hourFormatters.set(timeZone, formatter); }
  const value = formatter.format(epochMs);
  return Number(value);
}

function inRange(value: number, range: TimeRange): boolean {
  return (range.from === undefined || value >= range.from) && (range.to === undefined || value < range.to);
}

export function dailyActivity(db: DatabaseSync, range: TimeRange = {}): QueryResult<DailyActivity[]> {
  const timeZone = zone(range);
  const sessions = query<SessionTimeRow>(
    db,
    `SELECT id, time_created FROM session${range.projectId === undefined ? "" : " WHERE project_id = ?"}`,
    range.projectId === undefined ? [] : [range.projectId],
  ).filter((r) => inRange(r.time_created, range));
  const messages = query<TimedRow>(
    db,
    range.projectId === undefined
      ? "SELECT session_id, time_created FROM message"
      : "SELECT m.session_id, m.time_created FROM message m JOIN session s ON s.id = m.session_id WHERE s.project_id = ?",
    range.projectId === undefined ? [] : [range.projectId],
  ).filter((r) => inRange(r.time_created, range));
  const parts = query<PartTimeRow>(
    db,
    range.projectId === undefined
      ? "SELECT session_id, time_created, data FROM part"
      : "SELECT p.session_id, p.time_created, p.data FROM part p JOIN session s ON s.id = p.session_id WHERE s.project_id = ?",
    range.projectId === undefined ? [] : [range.projectId],
  ).filter((r) => inRange(r.time_created, range));
  const buckets = new Map<string, DailyActivity>();
  const ensure = (time: number) => {
    const date = localDay(time, timeZone);
    const bucket = buckets.get(date) ?? { date, sessionCount: 0, messageCount: 0, toolCallCount: 0 };
    buckets.set(date, bucket);
    return bucket;
  };
  sessions.forEach((r) => { ensure(r.time_created).sessionCount += 1; });
  messages.forEach((r) => { ensure(r.time_created).messageCount += 1; });
  const warnings: OcWarning[] = [];
  parts.forEach((r) => {
    const decoded = decodePartData(r.data);
    warnings.push(...decoded.warnings);
    if (decoded.value.type === "tool") ensure(r.time_created).toolCallCount += 1;
  });
  return { data: Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date)), warnings: mergeWarnings([warnings]) };
}

export function hourOfDay(db: DatabaseSync, range: TimeRange = {}): QueryResult<HourBucket[]> {
  const timeZone = zone(range);
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  query<SessionTimeRow>(db, "SELECT id, time_created FROM session").filter((r) => inRange(r.time_created, range)).forEach((row) => {
    const hour = localHour(row.time_created, timeZone);
    const bucket = buckets[hour]; if (bucket) bucket.count += 1;
  });
  return { data: buckets, warnings: [] };
}

export function dayOfWeek(db: DatabaseSync, range: TimeRange = {}): QueryResult<DayOfWeekBucket[]> {
  const timeZone = zone(range);
  const buckets = Array.from({ length: 7 }, (_, day) => ({ day, count: 0 }));
  query<SessionTimeRow>(db, "SELECT id, time_created FROM session").filter((r) => inRange(r.time_created, range)).forEach((row) => {
    const date = localDay(row.time_created, timeZone);
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    const bucket = buckets[day]; if (bucket) bucket.count += 1;
  });
  return { data: buckets, warnings: [] };
}

export function dailyTokens(db: DatabaseSync, range: TimeRange = {}): QueryResult<Array<{ date: string; tokens: OcTokens }>> {
  const timeZone = zone(range);
  const buckets = new Map<string, OcTokens>();
  query<TokenRow>(db, "SELECT id, time_created, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write FROM session")
    .filter((r) => inRange(r.time_created, range)).forEach((row) => {
      const date = localDay(row.time_created, timeZone);
      const tokens = buckets.get(date) ?? { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
      tokens.input += row.tokens_input ?? 0; tokens.output += row.tokens_output ?? 0;
      tokens.reasoning += row.tokens_reasoning ?? 0; tokens.cacheRead += row.tokens_cache_read ?? 0;
      tokens.cacheWrite += row.tokens_cache_write ?? 0; buckets.set(date, tokens);
    });
  return { data: Array.from(buckets, ([date, tokens]) => ({ date, tokens })).sort((a, b) => a.date.localeCompare(b.date)), warnings: [] };
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}

export function streaks(db: DatabaseSync, timeZone = "UTC", now = Date.now(), range: TimeRange = {}): QueryResult<StreakSummary> {
  const activity = dailyActivity(db, { ...range, timeZone });
  const dates = activity.data.filter((d) => d.sessionCount > 0).map((d) => d.date);
  if (dates.length === 0) return { data: { currentStreakDays: 0, longestStreakDays: 0, longestStreakStart: null, longestStreakEnd: null, mostActiveDay: null, totalActiveDays: 0, firstSessionDate: null }, warnings: activity.warnings };
  let longest = 1, run = 1, longestStart = dates[0] ?? null, longestEnd = dates[0] ?? null, runStart = dates[0] ?? "";
  for (let i = 1; i < dates.length; i += 1) {
    if (dates[i] === addDays(dates[i - 1] ?? "", 1)) run += 1; else { run = 1; runStart = dates[i] ?? ""; }
    if (run > longest) { longest = run; longestStart = runStart; longestEnd = dates[i] ?? null; }
  }
  const today = localDay(now, timeZone); let current = 0; let cursor = today; const set = new Set(dates);
  while (set.has(cursor)) { current += 1; cursor = addDays(cursor, -1); }
  const activityCount = (day: DailyActivity) => day.sessionCount + day.messageCount + day.toolCallCount;
  const most = [...activity.data].sort((a, b) => activityCount(b) - activityCount(a) || a.date.localeCompare(b.date))[0]?.date ?? null;
  return { data: { currentStreakDays: current, longestStreakDays: longest, longestStreakStart: longestStart, longestStreakEnd: longestEnd, mostActiveDay: most, totalActiveDays: dates.length, firstSessionDate: dates[0] ?? null }, warnings: activity.warnings };
}
