import type { DatabaseSync } from "node:sqlite";
import { decodePartData } from "@/lib/decode";
import { decodeMessageData } from "@/lib/decode/message";
import { mergeWarnings } from "@/lib/decode/warnings";
import { query } from "@/lib/db/connection";
import { categorizeTool, categorizeToolError, resolveMcpTool } from "@/lib/tools";
import type { FeatureAdoption, FeatureAdoptionRow, McpServerSummary, OcPartToolData, OcWarning, SkillSummary, ToolErrorSummary, ToolSummary } from "@/types/oc";

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
  if (filter.to !== undefined) { clauses.push("p.time_created <= ?"); params.push(filter.to); }
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

export function toolUsage(db: DatabaseSync, filter: PartQueryFilter = {}): QueryResult<ToolSummary[]> {
  const { calls, warnings } = toolRows(db, filter);
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
  return { data, warnings };
}

export function toolErrors(db: DatabaseSync, filter: PartQueryFilter = {}): QueryResult<ToolErrorSummary[]> {
  const { calls, warnings } = toolRows(db, filter);
  return { data: calls.filter((r) => r.tool.status === "error").map((r) => {
    const message = errorMessage(r);
    return { partId: r.id, sessionId: r.session_id, tool: r.tool.tool, message, category: categorizeToolError(message), timeCreated: r.time_created };
  }).sort((a, b) => b.timeCreated - a.timeCreated || a.partId.localeCompare(b.partId)), warnings };
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
  return typeof value === "string" && value.length > 0 ? value : "unknown";
}

export function skillUsage(db: DatabaseSync, filter: PartQueryFilter = {}): QueryResult<SkillSummary[]> {
  const { calls, warnings } = toolRows(db, filter);
  const skills = calls.filter((r) => r.tool.tool === "skill");
  const names = new Set(skills.map((r) => skillName(r.tool.input)));
  return { data: Array.from(names, (skill) => { const rows = skills.filter((r) => skillName(r.tool.input) === skill); return { skill, totalCalls: rows.length, sessionCount: new Set(rows.map((r) => r.session_id)).size, errorCount: rows.filter((r) => r.tool.status === "error").length }; }).sort((a, b) => b.totalCalls - a.totalCalls || a.skill.localeCompare(b.skill)), warnings };
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
    (filter.to === undefined || timeCreated <= filter.to);
}

function adoptionRow(all: SessionFeatureRow[], ids: Set<string>): FeatureAdoptionRow {
  const matching = all.filter((s) => ids.has(s.id));
  const times = matching.map((s) => s.time_created);
  return { sessionCount: matching.length, pct: all.length === 0 ? 0 : matching.length / all.length, firstUsed: times.length ? Math.min(...times) : null };
}

export function featureAdoption(db: DatabaseSync, servers: string[] = [], filter: FeatureAdoptionFilter = {}): QueryResult<FeatureAdoption> {
  const sessions = query<SessionFeatureRow>(db, "SELECT id, parent_id, time_created FROM session")
    .filter((row) => inFeatureRange(row.time_created, filter));
  const messages = query<MessageFeatureRow>(db, "SELECT session_id, time_created, data FROM message")
    .filter((row) => inFeatureRange(row.time_created, filter));
  const todos = query<TodoFeatureRow>(db, "SELECT session_id, time_created FROM todo")
    .filter((row) => inFeatureRange(row.time_created, filter));
  const { calls, warnings } = toolRows(db, filter);
  const subagents = new Set(sessions.filter((s) => s.parent_id !== null).map((s) => s.id));
  const mcp = new Set<string>(), webfetch = new Set<string>(), skills = new Set<string>(), reasoning = new Set<string>(), planMode = new Set<string>();
  const messageWarnings: OcWarning[] = [];
  for (const c of calls) { if (c.tool.tool === "task") subagents.add(c.session_id); if (resolveMcpTool(c.tool.tool, servers)) mcp.add(c.session_id); if (c.tool.tool === "webfetch") webfetch.add(c.session_id); if (c.tool.tool === "skill") skills.add(c.session_id); }
  for (const row of partRows(db, filter)) if (decodePartData(row.data).value.type === "reasoning") reasoning.add(row.session_id);
  for (const message of messages) {
    const decoded = decodeMessageData(message.data);
    messageWarnings.push(...decoded.warnings);
    if (decoded.value.mode === "plan") planMode.add(message.session_id);
  }
  const todoIds = new Set(todos.map((t) => t.session_id));
  return { data: { subagents: adoptionRow(sessions, subagents), mcp: adoptionRow(sessions, mcp), webfetch: adoptionRow(sessions, webfetch), planMode: adoptionRow(sessions, planMode), reasoning: adoptionRow(sessions, reasoning), todos: adoptionRow(sessions, todoIds), skills: adoptionRow(sessions, skills) }, warnings: mergeWarnings([warnings, messageWarnings]) };
}
