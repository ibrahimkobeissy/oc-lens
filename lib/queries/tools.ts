import type { DatabaseSync } from "node:sqlite";
import { decodePartData } from "@/lib/decode";
import { decodeMessageData } from "@/lib/decode/message";
import { mergeWarnings } from "@/lib/decode/warnings";
import { query } from "@/lib/db/connection";
import { categorizeTool, categorizeToolsBatch, categorizeToolError, resolveMcpTool } from "@/lib/tools";
import type { FeatureAdoption, FeatureAdoptionRow, FileChangeSummary, McpServerSummary, OcPartToolData, OcWarning, SkillSummary, ToolActivityPoint, ToolErrorSummary, ToolSummary } from "@/types/oc";
import { localDay } from "./activity";

export interface PartQueryFilter {
  from?: number;
  to?: number;
  projectId?: string;
  agent?: string;
  sessionId?: string;
}

export interface QueryResult<T> { data: T; warnings: OcWarning[] }

interface PartRow { id: string; session_id: string; message_id: string; time_created: number; data: string }

function partRows(db: DatabaseSync, filter: PartQueryFilter = {}): PartRow[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filter.from !== undefined) { clauses.push("p.time_created >= ?"); params.push(filter.from); }
  if (filter.to !== undefined) { clauses.push("p.time_created < ?"); params.push(filter.to); }
  if (filter.projectId !== undefined) { clauses.push("s.project_id = ?"); params.push(filter.projectId); }
  if (filter.agent !== undefined) { clauses.push("COALESCE(s.agent, 'unknown') = ?"); params.push(filter.agent); }
  if (filter.sessionId !== undefined) { clauses.push("p.session_id = ?"); params.push(filter.sessionId); }
  return query<PartRow>(db, `SELECT p.id, p.session_id, p.message_id, p.time_created, p.data FROM part p JOIN session s ON s.id = p.session_id${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""}`, params);
}

function toolRows(db: DatabaseSync, filter: PartQueryFilter = {}): { calls: Array<PartRow & { tool: OcPartToolData }>; warnings: OcWarning[] } {
  const calls: Array<PartRow & { tool: OcPartToolData }> = [];
  const warningCounts = new Map<string, { message: string; count: number }>();
  for (const row of partRows(db, filter)) {
    const decoded = decodePartData(row.data);
    for (const item of decoded.warnings) {
      const old = warningCounts.get(item.code);
      warningCounts.set(item.code, { message: item.message, count: (old?.count ?? 0) + item.count });
    }
    if (decoded.value.type === "tool") calls.push({ ...row, tool: decoded.value });
  }
  return { calls, warnings: Array.from(warningCounts, ([code, value]) => ({ code, ...value })) };
}

function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? null;
}

function errorMessage(row: PartRow & { tool: OcPartToolData }): string {
  if (row.tool.output) return row.tool.output;
  try {
    const raw: unknown = JSON.parse(row.data);
    if (typeof raw === "object" && raw !== null) {
      const state = (raw as Record<string, unknown>).state;
      if (typeof state === "object" && state !== null) {
        const value = (state as Record<string, unknown>).error;
        if (typeof value === "string" && value.length > 0) return value;
      }
    }
  } catch { /* decode warnings already surface malformed JSON */ }
  return "Unknown tool error";
}

export function toolUsage(db: DatabaseSync, filter: PartQueryFilter = {}, mcpServers: readonly string[] = []): QueryResult<ToolSummary[]> {
  const { calls, warnings } = toolRows(db, filter);
  const categorization = categorizeToolsBatch(calls
    .map((call) => call.tool.tool)
    .filter((name) => resolveMcpTool(name, [...mcpServers]) === null));
  const grouped = new Map<string, Array<(typeof calls)[number]>>();
  for (const call of calls) grouped.set(call.tool.tool, [...(grouped.get(call.tool.tool) ?? []), call]);
  const data = Array.from(grouped, ([tool, rows]) => {
    const durations = rows.flatMap(({ tool: t }) => t.timeStart === null || t.timeEnd === null ? [] : [t.timeEnd - t.timeStart]).sort((a, b) => a - b);
    return {
      tool, category: categorizeTool(tool), totalCalls: rows.length,
      completedCount: rows.filter((r) => r.tool.status === "completed").length,
      errorCount: rows.filter((r) => r.tool.status === "error").length,
      pendingCount: rows.filter((r) => r.tool.status === "pending").length,
      runningCount: rows.filter((r) => r.tool.status === "running").length,
      p50DurationMs: percentile(durations, 0.5), p95DurationMs: percentile(durations, 0.95),
      firstSeen: Math.min(...rows.map((r) => r.time_created)), lastSeen: Math.max(...rows.map((r) => r.time_created)),
    } satisfies ToolSummary;
  }).sort((a, b) => b.totalCalls - a.totalCalls || a.tool.localeCompare(b.tool));
  // Keep name-specific unknown-tool warnings distinct. mergeWarnings groups by
  // code and would otherwise attribute every unknown call to the first name.
  return { data, warnings: [...warnings, ...categorization.warnings] };
}

export function toolErrors(db: DatabaseSync, filter: PartQueryFilter = {}): QueryResult<ToolErrorSummary[]> {
  const { calls, warnings } = toolRows(db, filter);
  return { data: calls.filter((r) => r.tool.status === "error").map((r) => {
    const message = errorMessage(r);
    return { partId: r.id, sessionId: r.session_id, tool: r.tool.tool, message, category: categorizeToolError(message), timeCreated: r.time_created };
  }).sort((a, b) => b.timeCreated - a.timeCreated || a.partId.localeCompare(b.partId)), warnings };
}

export function toolActivity(db: DatabaseSync, filter: PartQueryFilter = {}, timeZone = "UTC"): QueryResult<ToolActivityPoint[]> {
  const { calls, warnings } = toolRows(db, filter);
  const days = new Map<string, ToolActivityPoint>();
  for (const call of calls) {
    const date = localDay(call.time_created, timeZone);
    const point = days.get(date) ?? { date, totalCalls: 0, errorCount: 0 };
    point.totalCalls += 1;
    if (call.tool.status === "error") point.errorCount += 1;
    days.set(date, point);
  }
  return { data: [...days.values()].sort((left, right) => left.date.localeCompare(right.date)), warnings };
}

export function mcpUsage(db: DatabaseSync, servers: string[], filter: PartQueryFilter = {}): QueryResult<McpServerSummary[]> {
  const { calls, warnings } = toolRows(db, filter);
  const grouped = new Map<string, Array<{ tool: string; error: boolean }>>();
  for (const call of calls) {
    const resolved = resolveMcpTool(call.tool.tool, servers);
    if (resolved) grouped.set(resolved.server, [...(grouped.get(resolved.server) ?? []), { tool: resolved.tool, error: call.tool.status === "error" }]);
  }
  const data = Array.from(grouped, ([server, rows]) => ({ server, toolCalls: rows.length, errorCount: rows.filter((r) => r.error).length, tools: Array.from(new Set(rows.map((r) => r.tool))).map((tool) => ({ tool, calls: rows.filter((r) => r.tool === tool).length })).sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool)) })).sort((a, b) => b.toolCalls - a.toolCalls || a.server.localeCompare(b.server));
  return { data, warnings };
}

function skillName(input: unknown): string {
  if (typeof input !== "object" || input === null) return "unknown";
  const value = (input as Record<string, unknown>).name;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "unknown";
}

export function skillUsage(db: DatabaseSync, filter: PartQueryFilter = {}): QueryResult<SkillSummary[]> {
  const { calls, warnings } = toolRows(db, filter);
  const grouped = new Map<string, Array<(typeof calls)[number]>>();
  for (const call of calls) {
    if (call.tool.tool !== "skill") continue;
    const name = skillName(call.tool.input);
    grouped.set(name, [...(grouped.get(name) ?? []), call]);
  }
  const data = Array.from(grouped, ([skill, rows]) => {
    const durations = rows.flatMap((row) => row.tool.timeStart === null || row.tool.timeEnd === null
      ? []
      : [row.tool.timeEnd - row.tool.timeStart]).sort((left, right) => left - right);
    return {
      skill,
      totalCalls: rows.length,
      sessionCount: new Set(rows.map((row) => row.session_id)).size,
      errorCount: rows.filter((row) => row.tool.status === "error").length,
      p50DurationMs: percentile(durations, 0.5),
      p95DurationMs: percentile(durations, 0.95),
    } satisfies SkillSummary;
  }).sort((left, right) => right.totalCalls - left.totalCalls || left.skill.localeCompare(right.skill));
  return { data, warnings };
}

const FILE_MUTATION_TOOLS = new Set(["write", "edit", "patch"]);

function stringField(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim().length > 0 ? field : null;
}

function absoluteFilePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(value);
}

function verifiedFilePath(row: PartRow & { tool: OcPartToolData }): string | null {
  const inputPath = stringField(row.tool.input, "filePath");
  let metadataPath: string | null = null;
  try {
    const raw: unknown = JSON.parse(row.data);
    if (typeof raw === "object" && raw !== null) {
      const state = (raw as Record<string, unknown>).state;
      if (typeof state === "object" && state !== null) {
        metadataPath = stringField((state as Record<string, unknown>).metadata, "filepath");
      }
    }
  } catch {
    // decodePartData already emitted the malformed-part warning.
  }
  if (metadataPath && absoluteFilePath(metadataPath)) return metadataPath;
  if (inputPath && absoluteFilePath(inputPath)) return inputPath;
  return metadataPath ?? inputPath;
}

/** OCL-103 fallback: ordered file touches from verified write/edit/patch tool-call fields, never unverified patch parts. */
export function fileChanges(db: DatabaseSync, sessionId: string): QueryResult<FileChangeSummary[]> {
  const { calls, warnings } = toolRows(db, { sessionId });
  let missingPathCount = 0;
  const data = calls.flatMap((row): FileChangeSummary[] => {
    if (!FILE_MUTATION_TOOLS.has(row.tool.tool) || row.tool.status !== "completed") return [];
    const filePath = verifiedFilePath(row);
    if (filePath === null) missingPathCount += 1;
    return filePath === null ? [] : [{ sessionId: row.session_id, filePath, tool: row.tool.tool, timeCreated: row.time_created, partId: row.id }];
  }).sort((left, right) => left.timeCreated - right.timeCreated || left.partId.localeCompare(right.partId));
  const missingWarnings: OcWarning[] = missingPathCount === 0 ? [] : [{
    code: "missing-file-path",
    message: "A completed write, edit, or patch tool call had no verified file path and was omitted from the file timeline.",
    count: missingPathCount,
  }];
  return { data, warnings: mergeWarnings([warnings, missingWarnings]) };
}

export interface FileTouchRollup {
  filePath: string;
  touchCount: number;
  sessionCount: number;
  lastTouched: number;
}

/** Pure rollup for a caller-provided project-scoped change set. */
export function filesMostTouched(changes: readonly FileChangeSummary[]): FileTouchRollup[] {
  const grouped = new Map<string, { touchCount: number; sessions: Set<string>; lastTouched: number }>();
  for (const change of changes) {
    const current = grouped.get(change.filePath) ?? { touchCount: 0, sessions: new Set<string>(), lastTouched: change.timeCreated };
    current.touchCount += 1;
    current.sessions.add(change.sessionId);
    current.lastTouched = Math.max(current.lastTouched, change.timeCreated);
    grouped.set(change.filePath, current);
  }
  return [...grouped].map(([filePath, value]) => ({
    filePath,
    touchCount: value.touchCount,
    sessionCount: value.sessions.size,
    lastTouched: value.lastTouched,
  })).sort((left, right) => right.touchCount - left.touchCount || right.lastTouched - left.lastTouched || left.filePath.localeCompare(right.filePath));
}

interface SessionFeatureRow { id: string; parent_id: string | null; time_created: number }
interface MessageFeatureRow { session_id: string; time_created: number; data: string }
interface TodoFeatureRow { session_id: string; time_created: number }

export interface FeatureAdoptionFilter {
  from?: number;
  to?: number;
}

function inFeatureRange(timeCreated: number, filter: FeatureAdoptionFilter): boolean {
  return (filter.from === undefined || timeCreated >= filter.from) &&
    (filter.to === undefined || timeCreated < filter.to);
}

function addFeature(events: Map<string, number>, sessionId: string, timeCreated: number): void {
  events.set(sessionId, Math.min(events.get(sessionId) ?? timeCreated, timeCreated));
}

function adoptionRow(cohort: SessionFeatureRow[], events: ReadonlyMap<string, number>): FeatureAdoptionRow {
  const matching = cohort.filter((session) => events.has(session.id));
  const times = matching.map((session) => events.get(session.id)).filter((time): time is number => time !== undefined);
  return { sessionCount: matching.length, pct: cohort.length === 0 ? 0 : matching.length / cohort.length, firstUsed: times.length ? Math.min(...times) : null };
}

export function featureAdoption(db: DatabaseSync, servers: string[] = [], filter: FeatureAdoptionFilter = {}): QueryResult<FeatureAdoption> {
  const sessions = query<SessionFeatureRow>(db, "SELECT id, parent_id, time_created FROM session");
  const messages = query<MessageFeatureRow>(db, "SELECT session_id, time_created, data FROM message")
    .filter((row) => inFeatureRange(row.time_created, filter));
  const todos = query<TodoFeatureRow>(db, "SELECT session_id, time_created FROM todo")
    .filter((row) => inFeatureRange(row.time_created, filter));
  const parts = partRows(db, filter);
  const { calls, warnings } = toolRows(db, filter);
  const cohortIds = new Set<string>();
  for (const session of sessions) if (inFeatureRange(session.time_created, filter)) cohortIds.add(session.id);
  for (const row of messages) cohortIds.add(row.session_id);
  for (const row of todos) cohortIds.add(row.session_id);
  for (const row of parts) cohortIds.add(row.session_id);
  const cohort = sessions.filter((session) => cohortIds.has(session.id));

  const subagents = new Map<string, number>();
  const mcp = new Map<string, number>(), webfetch = new Map<string, number>(), skills = new Map<string, number>(), reasoning = new Map<string, number>(), planMode = new Map<string, number>();
  const messageWarnings: OcWarning[] = [];
  for (const session of sessions) {
    if (session.parent_id !== null && inFeatureRange(session.time_created, filter)) addFeature(subagents, session.id, session.time_created);
  }
  for (const call of calls) {
    if (call.tool.tool === "task") addFeature(subagents, call.session_id, call.time_created);
    if (resolveMcpTool(call.tool.tool, servers)) addFeature(mcp, call.session_id, call.time_created);
    if (call.tool.tool === "webfetch") addFeature(webfetch, call.session_id, call.time_created);
    if (call.tool.tool === "skill") addFeature(skills, call.session_id, call.time_created);
  }
  for (const row of parts) if (decodePartData(row.data).value.type === "reasoning") addFeature(reasoning, row.session_id, row.time_created);
  for (const message of messages) {
    const decoded = decodeMessageData(message.data);
    messageWarnings.push(...decoded.warnings);
    if (decoded.value.mode === "plan") addFeature(planMode, message.session_id, message.time_created);
  }
  const todoEvents = new Map<string, number>();
  for (const todo of todos) addFeature(todoEvents, todo.session_id, todo.time_created);
  return { data: { subagents: adoptionRow(cohort, subagents), mcp: adoptionRow(cohort, mcp), webfetch: adoptionRow(cohort, webfetch), planMode: adoptionRow(cohort, planMode), reasoning: adoptionRow(cohort, reasoning), todos: adoptionRow(cohort, todoEvents), skills: adoptionRow(cohort, skills) }, warnings: mergeWarnings([warnings, messageWarnings]) };
}
