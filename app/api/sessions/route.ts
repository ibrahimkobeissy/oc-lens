import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";

import { readOpencodeConfig } from "@/lib/config/read";
import { redactConfig } from "@/lib/config/redact";
import { getConnection, query } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { decodePartData } from "@/lib/decode/part";
import { listSessions } from "@/lib/queries/sessions";
import type {
  OcErrorEnvelope,
  SessionListResponse,
  SessionSummary,
  SessionsRouteResponse,
} from "@/types/oc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_SEARCH_LENGTH = 200;

const SORT_KEYS = [
  "timeCreated",
  "timeUpdated",
  "timeArchived",
  "durationMs",
  "messages",
  "userMessages",
  "assistantMessages",
  "toolCallCount",
  "tokens",
  "inputTokens",
  "outputTokens",
  "reasoningTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "cost",
] as const;

type SortKey = (typeof SORT_KEYS)[number];
type SortOrder = "asc" | "desc";

interface ListRequest {
  project?: string;
  agent?: string;
  model?: string;
  from?: number;
  to?: number;
  archived?: boolean;
  hasError?: boolean;
  isSubagent?: boolean;
  search?: string;
  sort: SortKey;
  order: SortOrder;
  limit: number;
  cursor?: string;
}

interface CursorPayload {
  version: 1;
  signature: string;
  lastId: string;
}

interface PartRow {
  session_id: string;
  data: string | null;
}

interface WorktreeRow {
  worktree: string | null;
}

class InvalidQuery extends Error {}

function errorResponse(code: string, message: string, status: number): NextResponse<OcErrorEnvelope> {
  return NextResponse.json({ error: { code, message } }, { status });
}

function one(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1) throw new InvalidQuery(`Query parameter "${name}" may only be supplied once`);
  return values[0];
}

function optionalText(params: URLSearchParams, name: string): string | undefined {
  const value = one(params, name);
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) throw new InvalidQuery(`Query parameter "${name}" may not be empty`);
  return trimmed;
}

function optionalBoolean(params: URLSearchParams, name: string): boolean | undefined {
  const value = one(params, name);
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new InvalidQuery(`Query parameter "${name}" must be "true" or "false"`);
}

function optionalInteger(params: URLSearchParams, name: string): number | undefined {
  const value = one(params, name);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new InvalidQuery(`Query parameter "${name}" must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new InvalidQuery(`Query parameter "${name}" is outside the supported range`);
  return parsed;
}

function parseRequest(request: Request): ListRequest {
  const params = new URL(request.url).searchParams;
  const allowed = new Set([
    "project", "agent", "model", "from", "to", "archived", "hasError", "has-error",
    "isSubagent", "is-subagent", "search", "sort", "order", "limit", "cursor",
  ]);
  for (const name of params.keys()) {
    if (!allowed.has(name)) throw new InvalidQuery(`Unknown query parameter "${name}"`);
  }
  const project = optionalText(params, "project");
  const agent = optionalText(params, "agent");
  const model = optionalText(params, "model");
  const from = optionalInteger(params, "from");
  const to = optionalInteger(params, "to");
  const archived = optionalBoolean(params, "archived");
  const camelHasError = optionalBoolean(params, "hasError");
  const kebabHasError = optionalBoolean(params, "has-error");
  if (camelHasError !== undefined && kebabHasError !== undefined) {
    throw new InvalidQuery('Use only one of "hasError" and "has-error"');
  }
  const hasError = camelHasError ?? kebabHasError;
  const camelIsSubagent = optionalBoolean(params, "isSubagent");
  const kebabIsSubagent = optionalBoolean(params, "is-subagent");
  if (camelIsSubagent !== undefined && kebabIsSubagent !== undefined) {
    throw new InvalidQuery('Use only one of "isSubagent" and "is-subagent"');
  }
  const isSubagent = camelIsSubagent ?? kebabIsSubagent;
  const search = optionalText(params, "search");
  const rawSort = one(params, "sort") ?? "timeCreated";
  const rawOrder = one(params, "order") ?? "desc";
  const limit = optionalInteger(params, "limit") ?? DEFAULT_LIMIT;
  const cursor = optionalText(params, "cursor");

  if (from !== undefined && to !== undefined && from > to) {
    throw new InvalidQuery('Query parameter "from" must be less than or equal to "to"');
  }
  if (search !== undefined && search.length > MAX_SEARCH_LENGTH) {
    throw new InvalidQuery(`Query parameter "search" must be ${MAX_SEARCH_LENGTH} characters or fewer`);
  }
  if (!SORT_KEYS.some((key) => key === rawSort)) {
    throw new InvalidQuery(`Query parameter "sort" must be one of: ${SORT_KEYS.join(", ")}`);
  }
  if (rawOrder !== "asc" && rawOrder !== "desc") {
    throw new InvalidQuery('Query parameter "order" must be "asc" or "desc"');
  }
  if (limit < 1 || limit > MAX_LIMIT) {
    throw new InvalidQuery(`Query parameter "limit" must be between 1 and ${MAX_LIMIT}`);
  }

  return {
    project,
    agent,
    model,
    from,
    to,
    archived,
    hasError,
    isSubagent,
    search,
    sort: rawSort as SortKey,
    order: rawOrder,
    limit,
    cursor,
  };
}

function requestSignature(options: ListRequest): string {
  return JSON.stringify({
    project: options.project ?? null,
    agent: options.agent ?? null,
    model: options.model ?? null,
    from: options.from ?? null,
    to: options.to ?? null,
    archived: options.archived ?? null,
    hasError: options.hasError ?? null,
    isSubagent: options.isSubagent ?? null,
    search: options.search ?? null,
    sort: options.sort,
    order: options.order,
  });
}

function encodeCursor(options: ListRequest, lastId: string): string {
  const payload: CursorPayload = { version: 1, signature: requestSignature(options), lastId };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(raw: string, options: ListRequest): CursorPayload {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      parsed.version !== 1 ||
      !("signature" in parsed) ||
      parsed.signature !== requestSignature(options) ||
      !("lastId" in parsed) ||
      typeof parsed.lastId !== "string" ||
      parsed.lastId.length === 0
    ) {
      throw new Error("invalid cursor payload");
    }
    return parsed as CursorPayload;
  } catch {
    throw new InvalidQuery('Query parameter "cursor" is invalid or does not match these filters');
  }
}

function totalTokens(session: SessionSummary): number {
  return session.tokens.input + session.tokens.output + session.tokens.reasoning + session.tokens.cacheRead + session.tokens.cacheWrite;
}

function numericValue(session: SessionSummary, key: SortKey): number | null {
  switch (key) {
    case "timeCreated": return session.timeCreated;
    case "timeUpdated": return session.timeUpdated;
    case "timeArchived": return session.timeArchived;
    case "durationMs": return session.durationMs;
    case "messages": return session.messageCounts.user + session.messageCounts.assistant;
    case "userMessages": return session.messageCounts.user;
    case "assistantMessages": return session.messageCounts.assistant;
    case "toolCallCount": return session.toolCallCount;
    case "tokens": return totalTokens(session);
    case "inputTokens": return session.tokens.input;
    case "outputTokens": return session.tokens.output;
    case "reasoningTokens": return session.tokens.reasoning;
    case "cacheReadTokens": return session.tokens.cacheRead;
    case "cacheWriteTokens": return session.tokens.cacheWrite;
    case "cost": return session.cost.priced ? session.cost.amount : null;
  }
}

function compareSessions(left: SessionSummary, right: SessionSummary, sort: SortKey, order: SortOrder): number {
  const a = numericValue(left, sort);
  const b = numericValue(right, sort);
  // Unknown values remain at the end in either direction; they are not silently treated as zero.
  if (a === null && b !== null) return 1;
  if (a !== null && b === null) return -1;
  if (a !== null && b !== null && a !== b) return order === "asc" ? a - b : b - a;
  return left.id.localeCompare(right.id);
}

function matchesModel(session: SessionSummary, requested: string): boolean {
  if (requested === "unknown") return session.model === null;
  if (!session.model) return false;
  return requested === session.model.id || requested === `${session.model.providerID}/${session.model.id}`;
}

function matchesSearch(session: SessionSummary, requested: string): boolean {
  const term = requested.toLocaleLowerCase();
  const fields = [
    session.id,
    session.slug,
    session.title,
    session.projectId,
    session.projectDisplayName,
    session.agent ?? "unknown",
    session.model?.id ?? "unknown",
    session.model ? `${session.model.providerID}/${session.model.id}` : "unknown",
  ];
  return fields.some((field) => field.toLocaleLowerCase().includes(term));
}

function errorSessionIds(db: Parameters<typeof listSessions>[0]): Set<string> {
  const ids = new Set<string>();
  for (const row of query<PartRow>(db, "SELECT session_id, data FROM part")) {
    const decoded = decodePartData(row.data);
    if (decoded.value.type === "tool" && decoded.value.status === "error") ids.add(row.session_id);
  }
  return ids;
}

export async function GET(request: Request): Promise<NextResponse<SessionsRouteResponse>> {
  let options: ListRequest;
  try {
    options = parseRequest(request);
  } catch (error) {
    const message = error instanceof InvalidQuery ? error.message : "The session query is invalid";
    return errorResponse("invalid_query", message, 400);
  }

  try {
    const connection = getConnection();
    if (!connection.ok) {
      if (connection.reason === "not-found") {
        return errorResponse("database_not_found", "No opencode database was found. Check the database location in Settings.", 404);
      }
      return errorResponse("schema_mismatch", "The opencode database schema is not supported by this version of oc-lens.", 409);
    }

    const projectWorktrees = query<WorktreeRow>(
      connection.db,
      "SELECT worktree FROM project WHERE worktree IS NOT NULL AND worktree <> '' ORDER BY worktree",
    ).flatMap((row) => row.worktree === null ? [] : [row.worktree]);
    const config = readOpencodeConfig({ projectWorktrees });
    const mcpServers = config ? redactConfig(config).mcpServers.map((server) => server.name) : [];
    const result = listSessions(connection.db, {
      projectId: options.project,
      agent: options.agent === "unknown" ? null : options.agent,
      archived: options.archived,
      from: options.from,
      to: options.to,
      mcpServers,
    });
    const warnings = result.warnings;
    let sessions = result.data;

    if (options.model !== undefined) {
      const requestedModel = options.model;
      sessions = sessions.filter((session) => matchesModel(session, requestedModel));
    }
    if (options.isSubagent !== undefined) sessions = sessions.filter((session) => (session.parentId !== null) === options.isSubagent);
    if (options.search !== undefined) {
      const requestedSearch = options.search;
      sessions = sessions.filter((session) => matchesSearch(session, requestedSearch));
    }
    if (options.hasError !== undefined) {
      const errors = errorSessionIds(connection.db);
      sessions = sessions.filter((session) => errors.has(session.id) === options.hasError);
    }

    sessions.sort((left, right) => compareSessions(left, right, options.sort, options.order));
    const totalCount = sessions.length;
    let start = 0;
    if (options.cursor !== undefined) {
      const cursor = decodeCursor(options.cursor, options);
      const index = sessions.findIndex((session) => session.id === cursor.lastId);
      if (index < 0) return errorResponse("invalid_cursor", "The cursor no longer identifies a matching session.", 400);
      start = index + 1;
    }

    const page = sessions.slice(start, start + options.limit);
    const hasMore = start + page.length < sessions.length;
    const nextCursor = hasMore && page.length > 0 ? encodeCursor(options, page[page.length - 1]!.id) : null;
    const data: SessionListResponse = { sessions: page, totalCount, nextCursor };
    return NextResponse.json({
      data,
      meta: { generatedAt: Date.now(), schemaVersion, warnings },
    });
  } catch (error) {
    if (error instanceof InvalidQuery) return errorResponse("invalid_query", error.message, 400);
    return errorResponse("sessions_failed", "Sessions could not be read from the opencode database.", 500);
  }
}
