import type { DatabaseSync } from "node:sqlite";
import { query } from "@/lib/db/connection";
import { decodeMessageData } from "@/lib/decode/message";
import { decodePartData } from "@/lib/decode/part";
import { decodeSessionModel, isPlaceholderTitle } from "@/lib/decode/session";
import { mergeWarnings } from "@/lib/decode/warnings";
import { costBreakdown } from "@/lib/pricing/breakdown";
import { resolveMcpTool } from "@/lib/tools/mcp";
import type { OcTokens, OcWarning, PricingConfig, SessionDetail, SessionSummary } from "@/types/oc";

export interface QueryResult<T> {
  data: T;
  warnings: OcWarning[];
}

export interface SessionFilter {
  id?: string;
  projectId?: string;
  agent?: string | null;
  archived?: boolean;
  from?: number;
  to?: number;
  search?: string;
  /** Configured MCP server names; required because underscore-delimited tool names are otherwise ambiguous. */
  mcpServers?: readonly string[];
}

interface SessionRow {
  id: string;
  slug: string;
  title: string;
  project_id: string;
  project_name: string | null;
  project_worktree: string | null;
  directory: string;
  agent: string | null;
  model: string | null;
  version: string;
  time_created: number;
  time_updated: number;
  time_archived: number | null;
  parent_id: string | null;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
}

interface MessageRow { id: string; session_id: string; data: string | null }
interface PartRow { id: string; session_id: string; message_id: string; data: string | null; time_created: number }
interface ChildRow { id: string }

export function projectDisplayName(id: string, name: string | null, worktree: string | null): string {
  if (name?.trim()) return name;
  const clean = (worktree ?? "").replace(/\/+$/, "");
  const last = clean.split("/").filter(Boolean).at(-1);
  if (last) return last;
  return id === "global" ? "global" : id;
}

function zeroTokens(): OcTokens {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

function selectSessions(db: DatabaseSync, filter: SessionFilter): SessionRow[] {
  const clauses: string[] = [];
  const params: Array<string | number | null> = [];
  if (filter.id !== undefined) { clauses.push("s.id = ?"); params.push(filter.id); }
  if (filter.projectId !== undefined) { clauses.push("s.project_id = ?"); params.push(filter.projectId); }
  if (filter.agent !== undefined) {
    if (filter.agent === null || filter.agent === "unknown") clauses.push("s.agent IS NULL");
    else { clauses.push("s.agent = ?"); params.push(filter.agent); }
  }
  if (filter.archived !== undefined) clauses.push(filter.archived ? "s.time_archived IS NOT NULL" : "s.time_archived IS NULL");
  if (filter.from !== undefined) { clauses.push("s.time_created >= ?"); params.push(filter.from); }
  if (filter.to !== undefined) { clauses.push("s.time_created < ?"); params.push(filter.to); }
  if (filter.search?.trim()) {
    clauses.push("(LOWER(s.title) LIKE ? ESCAPE '\\' OR LOWER(s.slug) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(p.name, p.worktree, '')) LIKE ? ESCAPE '\\')");
    const escaped = filter.search.toLowerCase().replace(/[\\%_]/g, "\\$&");
    const term = `%${escaped}%`;
    params.push(term, term, term);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return query<SessionRow>(db, `
    SELECT s.id, s.slug, s.title, s.project_id, p.name AS project_name,
      p.worktree AS project_worktree, s.directory, s.agent, s.model, s.version,
      s.time_created, s.time_updated, s.time_archived, s.parent_id,
      s.tokens_input, s.tokens_output, s.tokens_reasoning,
      s.tokens_cache_read, s.tokens_cache_write
    FROM session s LEFT JOIN project p ON p.id = s.project_id
    ${where} ORDER BY s.time_created DESC, s.id`, params);
}

export function listSessions(db: DatabaseSync, filter: SessionFilter = {}, pricing?: PricingConfig): QueryResult<SessionSummary[]> {
  const rows = selectSessions(db, filter);
  if (rows.length === 0) return { data: [], warnings: [] };
  const ids = rows.map((row) => row.id);
  const loadForSessions = <T>(select: string): T[] => {
    const loaded: T[] = [];
    for (let offset = 0; offset < ids.length; offset += 800) {
      const chunk = ids.slice(offset, offset + 800);
      const placeholders = chunk.map(() => "?").join(",");
      loaded.push(...query<T>(db, `${select} WHERE session_id IN (${placeholders}) ORDER BY time_created, id`, chunk));
    }
    return loaded;
  };
  const messages = loadForSessions<MessageRow>("SELECT id, session_id, data FROM message");
  const parts = loadForSessions<PartRow>("SELECT id, session_id, message_id, data, time_created FROM part");
  const mcpServers = [...(filter.mcpServers ?? [])];

  const messageCounts = new Map<string, { user: number; assistant: number }>();
  const firstUserMessageIds = new Map<string, string>();
  const warnings: OcWarning[][] = [];
  for (const row of messages) {
    const decoded = decodeMessageData(row.data);
    warnings.push(decoded.warnings);
    const counts = messageCounts.get(row.session_id) ?? { user: 0, assistant: 0 };
    if (decoded.value.role === "user") {
      counts.user += 1;
      if (!firstUserMessageIds.has(row.session_id)) firstUserMessageIds.set(row.session_id, row.id);
    } else if (decoded.value.role === "assistant") counts.assistant += 1;
    messageCounts.set(row.session_id, counts);
  }
  const unknownAgentCount = rows.filter((row) => row.agent === null).length;
  const unknownModelCount = rows.filter((row) => row.model === null).length;
  if (unknownAgentCount > 0) warnings.push([{ code: "unknown-agent", message: "Sessions had no recorded agent", count: unknownAgentCount }]);
  if (unknownModelCount > 0) warnings.push([{ code: "unknown-model", message: "Sessions had no recorded model", count: unknownModelCount }]);

  const flags = new Map<string, { toolCalls: number; errors: number; reasoning: boolean; compaction: boolean; mcp: boolean; task: boolean; webfetch: boolean }>();
  const firstUserText = new Map<string, string>();
  for (const row of parts) {
    const decoded = decodePartData(row.data);
    warnings.push(decoded.warnings);
    const state = flags.get(row.session_id) ?? { toolCalls: 0, errors: 0, reasoning: false, compaction: false, mcp: false, task: false, webfetch: false };
    if (decoded.value.type === "reasoning") state.reasoning = true;
    if (decoded.value.type === "compaction") state.compaction = true;
    if (decoded.value.type === "text" && firstUserMessageIds.get(row.session_id) === row.message_id && !firstUserText.has(row.session_id)) {
      const text = decoded.value.text.trim();
      if (text) firstUserText.set(row.session_id, text);
    }
    if (decoded.value.type === "tool") {
      state.toolCalls += 1;
      if (decoded.value.status === "error") state.errors += 1;
      state.task ||= decoded.value.tool === "task";
      state.webfetch ||= decoded.value.tool === "webfetch";
      state.mcp ||= resolveMcpTool(decoded.value.tool, mcpServers) !== null;
    }
    flags.set(row.session_id, state);
  }
  const parentIds = new Set(query<{ parent_id: string }>(db, "SELECT DISTINCT parent_id FROM session WHERE parent_id IS NOT NULL").map((row) => row.parent_id));
  // Scoped to this page's session ids rather than a full-DB pass (code-review-2026-08-02.md M2).
  const costs = pricing === undefined
    ? new Map<string, SessionSummary["cost"]>()
    : new Map(costBreakdown(db, pricing, "UTC", {}, ids).bySession.map((entry) => [entry.sessionId, entry.cost]));

  const data = rows.map((row): SessionSummary => {
    const model = decodeSessionModel(row.model);
    warnings.push(model.warnings);
    const state = flags.get(row.id) ?? { toolCalls: 0, errors: 0, reasoning: false, compaction: false, mcp: false, task: false, webfetch: false };
    const title = isPlaceholderTitle(row.title) ? (firstUserText.get(row.id) ?? row.slug) : row.title;
    const duration = row.time_updated >= row.time_created ? row.time_updated - row.time_created : null;
    return {
      id: row.id, slug: row.slug, title, projectId: row.project_id,
      projectDisplayName: projectDisplayName(row.project_id, row.project_name, row.project_worktree),
      directory: row.directory, agent: row.agent, model: model.value, version: row.version,
      timeCreated: row.time_created, timeUpdated: row.time_updated, durationMs: duration,
      timeArchived: row.time_archived, parentId: row.parent_id,
      messageCounts: messageCounts.get(row.id) ?? { user: 0, assistant: 0 },
      toolCallCount: state.toolCalls,
      errorCount: state.errors,
      tokens: {
        input: row.tokens_input ?? 0, output: row.tokens_output ?? 0,
        reasoning: row.tokens_reasoning ?? 0, cacheRead: row.tokens_cache_read ?? 0,
        cacheWrite: row.tokens_cache_write ?? 0,
      },
      cost: costs.get(row.id) ?? { amount: 0, priced: false }, hasReasoning: state.reasoning,
      hasCompaction: state.compaction, usesMcp: state.mcp,
      usesSubagent: state.task || parentIds.has(row.id), usesWebfetch: state.webfetch,
    };
  });
  return { data, warnings: mergeWarnings(warnings) };
}

export function getSession(db: DatabaseSync, id: string, pricing?: PricingConfig): QueryResult<SessionDetail | null> {
  const result = listSessions(db, { id }, pricing);
  const session = result.data[0];
  if (!session) return { data: null, warnings: result.warnings };
  const childIds = query<ChildRow>(db, "SELECT id FROM session WHERE parent_id = ? ORDER BY time_created, id", [id]).map((r) => r.id);
  return { data: { ...session, childIds }, warnings: result.warnings };
}

export { zeroTokens };
