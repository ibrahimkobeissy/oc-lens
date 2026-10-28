import type { DatabaseSync } from "node:sqlite";

import { query } from "@/lib/db/connection";

/**
 * Builds the JSON that `opencode session import <file>` accepts: opencode 2.x's
 * `SessionTransfer.Data`, `{ info: Session.Info, messages: SessionMessage[] }`
 * (data-model §8.6, verified against opencode 2.2.0 on 2026-10-28).
 *
 * Reads `session_v2` and `session_message` directly — not the canonical v1
 * views, which project into 1.x shapes opencode 2.x cannot import. Message rows
 * are emitted verbatim apart from restoring the `id` and `type` columns that
 * opencode strips from `data`; older field names in that payload (`state` on
 * text/reasoning content, `recent` on compaction) are left for opencode's own
 * import decoder, which upgrades them explicitly.
 */

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export interface SessionTransferInfo {
  id: string;
  parentID?: string;
  fork?: { sessionID: string; boundary: JsonValue };
  projectID: string;
  agent?: string;
  model?: JsonValue;
  cost: number;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  outcome?: string;
  time: { created: number; updated: number; idle?: number; viewed?: number; archived?: number };
  title?: string;
  location: { directory: string };
  subpath?: string;
  metadata?: JsonValue;
  permissions?: JsonValue;
  revert?: JsonValue;
}

export interface SessionTransferMessage extends JsonObject {
  id: string;
  type: string;
}

export interface SessionTransfer {
  info: SessionTransferInfo;
  messages: SessionTransferMessage[];
}

export type SessionTransferResult =
  | { ok: true; data: SessionTransfer }
  | { ok: false; reason: "no-v2-tables" | "not-found" | "legacy-only" | "unreadable" };

interface SessionV2Row {
  id: string;
  project_id: string;
  parent_id: string | null;
  fork_session_id: string | null;
  fork_boundary: string | null;
  directory: string;
  path: string | null;
  title: string | null;
  metadata: string | null;
  cost: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  revert: string | null;
  permission: string | null;
  agent: string | null;
  model: string | null;
  time_created: number;
  time_updated: number;
  time_idle: number | null;
  time_viewed: number | null;
  time_archived: number | null;
  idle_outcome: string | null;
}

interface SessionMessageRow {
  id: string;
  type: string;
  data: string;
}

class UnreadableRow extends Error {}

function tableExists(db: DatabaseSync, table: string): boolean {
  return query(db, "SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = ?", [table]).length > 0;
}

// Decoder boundary: these columns hold opencode-owned JSON that is passed
// through to opencode unchanged, so it is only checked to be valid JSON.
function parseJson(raw: string): JsonValue {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    throw new UnreadableRow();
  }
}

function optionalJson(raw: string | null): JsonValue | undefined {
  return raw === null ? undefined : parseJson(raw);
}

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sessionInfo(row: SessionV2Row): SessionTransferInfo {
  // `undefined` fields are dropped by JSON.stringify, matching opencode's own
  // export, which omits absent optionals rather than writing null.
  return {
    id: row.id,
    parentID: row.parent_id ?? undefined,
    fork: row.fork_session_id === null ? undefined : { sessionID: row.fork_session_id, boundary: optionalJson(row.fork_boundary) ?? null },
    projectID: row.project_id,
    agent: row.agent ?? undefined,
    model: optionalJson(row.model),
    cost: row.cost,
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cache: { read: row.tokens_cache_read, write: row.tokens_cache_write },
    },
    outcome: row.idle_outcome ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      idle: row.time_idle ?? undefined,
      viewed: row.time_viewed ?? undefined,
      archived: row.time_archived ?? undefined,
    },
    title: row.title ?? undefined,
    location: { directory: row.directory },
    // opencode stores "" for a session at its project root and omits subpath on export.
    subpath: row.path ? row.path : undefined,
    metadata: optionalJson(row.metadata),
    permissions: optionalJson(row.permission),
    revert: optionalJson(row.revert),
  };
}

function transferMessage(row: SessionMessageRow): SessionTransferMessage {
  const data = parseJson(row.data);
  if (!isObject(data)) throw new UnreadableRow();
  return { ...data, id: row.id, type: row.type };
}

/** A download name safe to put in a Content-Disposition header. */
export function transferFileName(sessionId: string): string {
  return `opencode-session-${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
}

export function sessionTransfer(db: DatabaseSync, sessionId: string): SessionTransferResult {
  const hasV2 = tableExists(db, "session_v2") && tableExists(db, "session_message");
  const hasLegacy = tableExists(db, "session");
  const legacyHit = () => query(db, "SELECT 1 FROM main.session WHERE id = ?", [sessionId]).length > 0;

  if (!hasV2) return { ok: false, reason: hasLegacy && legacyHit() ? "no-v2-tables" : "not-found" };

  const session = query<SessionV2Row>(db, `
    SELECT id, project_id, parent_id, fork_session_id, fork_boundary, directory, path, title, metadata, cost,
      tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, revert, permission,
      agent, model, time_created, time_updated, time_idle, time_viewed, time_archived, idle_outcome
    FROM main.session_v2
    WHERE id = ?
  `, [sessionId])[0];
  if (!session) return { ok: false, reason: hasLegacy && legacyHit() ? "legacy-only" : "not-found" };

  const rows = query<SessionMessageRow>(db, "SELECT id, type, data FROM main.session_message WHERE session_id = ? ORDER BY seq", [sessionId]);
  try {
    return { ok: true, data: { info: sessionInfo(session), messages: rows.map(transferMessage) } };
  } catch (error) {
    if (error instanceof UnreadableRow) return { ok: false, reason: "unreadable" };
    throw error;
  }
}
