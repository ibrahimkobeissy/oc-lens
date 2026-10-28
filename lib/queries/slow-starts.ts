import type { DatabaseSync } from "node:sqlite";

import { query } from "@/lib/db/connection";
import { isPlaceholderTitle } from "@/lib/decode/session";
import {
  SLOW_START_FACTOR,
  SLOW_START_MIN_SECONDS,
  type SlowStartDay,
  type SlowStartReport,
  type SlowStep,
} from "@/lib/audit/slow-start-types";

export type { SlowStartReport, SlowStep };

/**
 * Steps that waited far longer than usual for their first token (data-model §8.7).
 *
 * opencode retries a failing provider call inside the step and then deletes
 * the record of it, so a call that hit 500s and then worked is stored like any
 * other. Retrying takes time, though, and opencode 2.x stores when the first
 * token arrived (`time.streamed`). A step whose wait is far above its model's
 * usual is reported as a *possible* hidden retry — a slow provider looks the
 * same, so it is never presented as a confirmed failure.
 *
 * Reads `session_message` directly: `streamed` exists only there, and a
 * migrated 1.x message does not carry it, so nothing is counted twice.
 */

interface StepRow {
  id: string;
  session_id: string;
  created: number | null;
  streamed: number | null;
  provider: string | null;
  model: string | null;
}

interface SessionRow {
  id: string;
  slug: string;
  title: string;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function localDay(epochMs: number, timeZone: string): string {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }); dayFormatters.set(timeZone, formatter); }
  return formatter.format(new Date(epochMs));
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return query(db, "SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = ?", [table]).length > 0;
}

export function slowStartReport(db: DatabaseSync, timeZone = "UTC", range: { from?: number; to?: number } = {}, sessionId?: string): SlowStartReport {
  // 1.x also has a session_message table, holding lifecycle events with no first-token time; only 2.x records one.
  if (!tableExists(db, "session_v2")) return { measurable: false, byDay: [], slowSteps: [] };
  const rows = query<StepRow>(db, `
    SELECT id, session_id,
      json_extract(data, '$.time.created') AS created, json_extract(data, '$.time.streamed') AS streamed,
      json_extract(data, '$.model.providerID') AS provider, json_extract(data, '$.model.id') AS model
    FROM main.session_message
    WHERE type = 'assistant' AND json_extract(data, '$.time.streamed') IS NOT NULL
  `);
  const steps = rows.flatMap((row) => {
    if (typeof row.created !== "number" || typeof row.streamed !== "number" || row.streamed < row.created) return [];
    return [{ id: row.id, sessionId: row.session_id, created: row.created, wait: (row.streamed - row.created) / 1000, modelKey: `${row.provider ?? "unknown"}/${row.model ?? "unknown"}` }];
  });

  // The baseline is all-time and per model, so a session or a day that is slow throughout still stands out.
  const waitsByModel = new Map<string, number[]>();
  for (const step of steps) {
    const list = waitsByModel.get(step.modelKey) ?? [];
    list.push(step.wait);
    waitsByModel.set(step.modelKey, list);
  }
  const baseline = new Map([...waitsByModel].map(([model, waits]) => [model, percentile([...waits].sort((a, b) => a - b), 0.5)]));
  const isSlow = (wait: number, model: string) => wait >= SLOW_START_MIN_SECONDS && wait > (baseline.get(model) ?? 0) * SLOW_START_FACTOR;

  const inScope = steps.filter((step) =>
    (sessionId === undefined || step.sessionId === sessionId)
    && (range.from === undefined || step.created >= range.from)
    && (range.to === undefined || step.created < range.to));
  const slow = inScope.filter((step) => isSlow(step.wait, step.modelKey));

  const byDate = new Map<string, number[]>();
  const slowByDate = new Map<string, number>();
  for (const step of inScope) {
    const date = localDay(step.created, timeZone);
    const list = byDate.get(date) ?? [];
    list.push(step.wait);
    byDate.set(date, list);
  }
  for (const step of slow) {
    const date = localDay(step.created, timeZone);
    slowByDate.set(date, (slowByDate.get(date) ?? 0) + 1);
  }
  const byDay: SlowStartDay[] = [...byDate].map(([date, waits]) => {
    const sorted = [...waits].sort((a, b) => a - b);
    return { date, steps: sorted.length, medianSeconds: percentile(sorted, 0.5), p90Seconds: percentile(sorted, 0.9), slowSteps: slowByDate.get(date) ?? 0 };
  }).sort((left, right) => right.date.localeCompare(left.date));

  const sessionIds = [...new Set(slow.map((step) => step.sessionId))];
  const titles = sessionIds.length === 0 ? new Map<string, string>() : new Map(query<SessionRow>(db,
    `SELECT id, slug, title FROM session WHERE id IN (${sessionIds.map(() => "?").join(",")})`, sessionIds)
    .map((session) => [session.id, isPlaceholderTitle(session.title) ? session.slug : session.title]));
  const slowSteps: SlowStep[] = slow.map((step) => ({
    messageId: step.id,
    sessionId: step.sessionId,
    sessionTitle: titles.get(step.sessionId) ?? step.sessionId,
    timeCreated: step.created,
    model: step.modelKey,
    waitSeconds: step.wait,
    baselineSeconds: baseline.get(step.modelKey) ?? 0,
  })).sort((left, right) => right.timeCreated - left.timeCreated);

  return { measurable: steps.length > 0, byDay, slowSteps };
}
