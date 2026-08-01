import type { DatabaseSync } from "node:sqlite";
import { query } from "@/lib/db/connection";
import { decodeMessageData, decodePartData, decodeSessionModel, isPlaceholderTitle, mergeWarnings } from "@/lib/decode";
import { resolveMcpTool } from "@/lib/tools";
import type { OcCost, OcTokens, OcWarning, ReplayPart, ReplayTurn, SessionReplay, SessionSummary, SubagentNode } from "@/types/oc";

export interface ReplayQueryResult<T> { data: T; warnings: OcWarning[] }

interface SessionRow {
  id: string; project_id: string; parent_id: string | null; slug: string; directory: string; title: string; version: string;
  agent: string | null; model: string | null; time_created: number; time_updated: number; time_archived: number | null;
  tokens_input: number | null; tokens_output: number | null; tokens_reasoning: number | null; tokens_cache_read: number | null; tokens_cache_write: number | null;
}
interface MessageRow { id: string; session_id: string; time_created: number; data: string }
interface PartRow { id: string; message_id: string; session_id: string; time_created: number; data: string }
interface ProjectRow { id: string; name: string | null; worktree: string | null }

const UNPRICED: OcCost = { amount: 0, priced: false };
const zeroTokens = (): OcTokens => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
function tokens(row: SessionRow): OcTokens { return { input: row.tokens_input ?? 0, output: row.tokens_output ?? 0, reasoning: row.tokens_reasoning ?? 0, cacheRead: row.tokens_cache_read ?? 0, cacheWrite: row.tokens_cache_write ?? 0 }; }
function add(target: OcTokens, value: OcTokens): void { target.input += value.input; target.output += value.output; target.reasoning += value.reasoning; target.cacheRead += value.cacheRead; target.cacheWrite += value.cacheWrite; }

function displayName(project: ProjectRow | undefined): string {
  if (!project) return "unknown";
  if (project.name?.trim()) return project.name;
  const pieces = (project.worktree ?? "").split("/").filter(Boolean);
  const basename = pieces.at(-1);
  if (basename) return basename;
  return project.id === "global" ? "global" : project.id;
}

function loadSession(db: DatabaseSync, id: string): SessionRow | null {
  return query<SessionRow>(db, `SELECT id, project_id, parent_id, slug, directory, title, version, agent, model, time_created, time_updated, time_archived, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write FROM session WHERE id = ?`, [id])[0] ?? null;
}

function summary(db: DatabaseSync, session: SessionRow, messages: MessageRow[], parts: PartRow[], mcpServers: string[]): { value: SessionSummary; warnings: OcWarning[] } {
  const decodedModel = decodeSessionModel(session.model);
  const decodedMessages = messages.map((message) => ({ id: message.id, data: decodeMessageData(message.data).value }));
  const roles = decodedMessages.map((message) => message.data.role);
  const decodedParts = parts.map((part) => ({ messageId: part.message_id, data: decodePartData(part.data).value }));
  const firstUserMessageId = decodedMessages.find((message) => message.data.role === "user")?.id;
  const firstUserText = decodedParts.find((part) => part.messageId === firstUserMessageId && part.data.type === "text" && part.data.text.trim().length > 0);
  const title = isPlaceholderTitle(session.title) ? (firstUserText?.data.type === "text" ? firstUserText.data.text.trim() : session.slug) : session.title;
  const project = query<ProjectRow>(db, "SELECT id, name, worktree FROM project WHERE id = ?", [session.project_id])[0];
  return { value: {
    id: session.id, slug: session.slug, title, projectId: session.project_id, projectDisplayName: displayName(project), directory: session.directory,
    agent: session.agent, model: decodedModel.value, version: session.version, timeCreated: session.time_created, timeUpdated: session.time_updated,
    durationMs: session.time_updated >= session.time_created ? session.time_updated - session.time_created : null, timeArchived: session.time_archived, parentId: session.parent_id,
    messageCounts: { user: roles.filter((r) => r === "user").length, assistant: roles.filter((r) => r === "assistant").length },
    toolCallCount: decodedParts.filter((part) => part.data.type === "tool").length, tokens: tokens(session), cost: UNPRICED,
    hasReasoning: decodedParts.some((part) => part.data.type === "reasoning"), hasCompaction: false,
    usesMcp: decodedParts.some((part) => part.data.type === "tool" && resolveMcpTool(part.data.tool, mcpServers) !== null),
    usesSubagent: decodedParts.some((part) => part.data.type === "tool" && part.data.tool === "task") || query<{ id: string }>(db, "SELECT id FROM session WHERE parent_id = ? LIMIT 1", [session.id]).length > 0,
    usesWebfetch: decodedParts.some((part) => part.data.type === "tool" && part.data.tool === "webfetch"),
  }, warnings: decodedModel.warnings };
}

export function getReplay(db: DatabaseSync, sessionId: string, mcpServers: string[] = []): ReplayQueryResult<SessionReplay | null> {
  const session = loadSession(db, sessionId);
  if (!session) return { data: null, warnings: [] };
  const messages = query<MessageRow>(db, "SELECT id, session_id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id", [sessionId]);
  const parts = query<PartRow>(db, "SELECT id, message_id, session_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created, id", [sessionId]);
  const byMessage = new Map<string, PartRow[]>();
  for (const part of parts) byMessage.set(part.message_id, [...(byMessage.get(part.message_id) ?? []), part]);
  const warnings: OcWarning[] = [];
  const turns: ReplayTurn[] = messages.map((message) => {
    const decoded = decodeMessageData(message.data); warnings.push(...decoded.warnings);
    const replayParts: ReplayPart[] = (byMessage.get(message.id) ?? []).map((part) => { const result = decodePartData(part.data); warnings.push(...result.warnings); return { id: part.id, data: result.value }; });
    const created = decoded.value.timeCreated ?? message.time_created;
    const completed = decoded.value.timeCompleted;
    return { messageId: message.id, role: decoded.value.role, agent: decoded.value.agent, timeCreated: created, timeCompleted: completed, durationMs: completed === null ? null : completed - created, tokens: decoded.value.tokens, cost: UNPRICED, parts: replayParts };
  });
  const accumulation = zeroTokens();
  const tokenAccumulation = turns.map((turn, atTurnIndex) => {
    for (const part of turn.parts) if (part.data.type === "step-finish" && part.data.tokens) add(accumulation, part.data.tokens);
    return { atTurnIndex, tokens: { ...accumulation } };
  });
  const sessionSummary = summary(db, session, messages, parts, mcpServers); warnings.push(...sessionSummary.warnings);
  const childIds = query<{ id: string }>(db, "SELECT id FROM session WHERE parent_id = ? ORDER BY time_created, id", [sessionId]).map((r) => r.id);
  return { data: { session: sessionSummary.value, parentId: session.parent_id, childIds, turns, tokenAccumulation }, warnings: mergeWarnings([warnings]) };
}

function treeNode(db: DatabaseSync, row: SessionRow, depth: number, path: Set<string>, warnings: OcWarning[]): SubagentNode {
  const decodedModel = decodeSessionModel(row.model); warnings.push(...decodedModel.warnings);
  let toolCallCount = 0;
  for (const part of query<PartRow>(db, "SELECT id, message_id, session_id, time_created, data FROM part WHERE session_id = ?", [row.id])) {
    const decoded = decodePartData(part.data); warnings.push(...decoded.warnings);
    if (decoded.value.type === "tool") toolCallCount += 1;
  }
  const children: SubagentNode[] = [];
  if (depth < 10) {
    for (const child of query<SessionRow>(db, `SELECT id, project_id, parent_id, slug, directory, title, version, agent, model, time_created, time_updated, time_archived, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write FROM session WHERE parent_id = ? ORDER BY time_created, id`, [row.id])) {
      if (path.has(child.id)) { warnings.push({ code: "subagent-cycle", message: `Cycle detected at session ${child.id}`, count: 1 }); continue; }
      children.push(treeNode(db, child, depth + 1, new Set([...path, child.id]), warnings));
    }
  } else if (query<{ id: string }>(db, "SELECT id FROM session WHERE parent_id = ? LIMIT 1", [row.id]).length) warnings.push({ code: "subagent-depth-limit", message: "Subagent tree exceeded the maximum depth of 10", count: 1 });
  return { sessionId: row.id, agent: row.agent, model: decodedModel.value, durationMs: row.time_updated >= row.time_created ? row.time_updated - row.time_created : null, tokens: tokens(row), cost: UNPRICED, toolCallCount, children };
}

export function subagentTree(db: DatabaseSync, rootId: string): ReplayQueryResult<SubagentNode | null> {
  const root = loadSession(db, rootId); const warnings: OcWarning[] = [];
  if (!root) return { data: null, warnings };
  return { data: treeNode(db, root, 0, new Set([root.id]), warnings), warnings: mergeWarnings([warnings]) };
}
