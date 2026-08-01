import type { DatabaseSync } from "node:sqlite";
import { NextResponse } from "next/server";

import { readOpencodeConfig } from "@/lib/config/read";
import { redactConfig } from "@/lib/config/redact";
import { getConnection, query } from "@/lib/db/connection";
import { schemaVersion } from "@/lib/db/schema-guard";
import { decodeMessageData } from "@/lib/decode/message";
import { decodePartData } from "@/lib/decode/part";
import { decodeSessionModel, isPlaceholderTitle } from "@/lib/decode/session";
import { mergeWarnings } from "@/lib/decode/warnings";
import { costBreakdown } from "@/lib/pricing/breakdown";
import { readPricing } from "@/lib/pricing/config";
import { dailyActivity, dayOfWeek, hourOfDay, localDay } from "@/lib/queries/activity";
import { getOverviewStats, versionHistory } from "@/lib/queries/projects";
import { listSessions, projectDisplayName } from "@/lib/queries/sessions";
import { readTodos } from "@/lib/queries/todos";
import { featureAdoption, mcpUsage, skillUsage, toolActivity, toolErrors, toolUsage } from "@/lib/queries/tools";
import { resolveMcpTool } from "@/lib/tools/mcp";
import type {
  ActivityStats,
  ExportManifestCounts,
  ExportResponse,
  ExportRouteResponse,
  OcTokens,
  OcWarning,
  OverviewStats,
  SessionSummary,
  StreakSummary,
  TodosResponse,
  ToolsStats,
} from "@/types/oc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SCOPES = ["sessions", "stats", "activity", "tools", "todos", "replay"] as const;
const STREAM_TEXT_CHARS = 32 * 1024;
const PART_PAGE_SIZE = 128;
type ExportScope = (typeof SCOPES)[number];

interface ExportOptions {
  scopes: Set<ExportScope>;
  preview: boolean;
  timeZone: string;
  from?: number;
  to?: number;
}

interface CountRow {
  count: number;
}

interface IdRow {
  id: string;
}

interface WorktreeRow {
  worktree: string;
}

interface ReplaySessionRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  slug: string;
  directory: string;
  title: string;
  version: string;
  agent: string | null;
  model: string | null;
  time_created: number;
  time_updated: number;
  time_archived: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  tokens_reasoning: number | null;
  tokens_cache_read: number | null;
  tokens_cache_write: number | null;
  project_name: string | null;
  project_worktree: string | null;
}

interface ReplayMessageRow {
  id: string;
  time_created: number;
  data: string | null;
}

interface ReplayPartRow {
  id: string;
  time_created: number;
  data: string | null;
}

interface PartFlagsRow {
  tool_count: number;
  error_count: number;
  has_reasoning: number;
  uses_task: number;
  uses_webfetch: number;
}

interface ToolNameRow {
  tool: string;
}

class InvalidExportQuery extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function errorResponse(code: string, message: string, status: number): NextResponse<ExportRouteResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function addLocalDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localParts(epochMs: number, timeZone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    formatter.formatToParts(epochMs)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

/** Converts a calendar date in an IANA zone to its local midnight epoch. */
function localMidnight(value: string, timeZone: string): number {
  const [year, month, day] = value.split("-").map(Number);
  const target = Date.UTC(year!, month! - 1, day!);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = localParts(candidate, timeZone);
    const represented = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
    candidate += target - represented;
  }
  return candidate;
}

function parseOptions(request: Request): ExportOptions {
  const params = new URL(request.url).searchParams;
  const timeZone = params.get("tz") ?? "UTC";
  if (!validTimeZone(timeZone)) throw new InvalidExportQuery("invalid_timezone", "Timezone must be a valid IANA timezone.");

  const previewValue = params.get("preview");
  if (previewValue !== null && previewValue !== "0" && previewValue !== "1") {
    throw new InvalidExportQuery("invalid_preview", "preview must be 0 or 1.");
  }

  const rawScopes = params.getAll("scope").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  const selected = rawScopes.length === 0 ? [...SCOPES] : rawScopes;
  const invalidScope = selected.find((scope) => !(SCOPES as readonly string[]).includes(scope));
  if (invalidScope) {
    throw new InvalidExportQuery("invalid_scope", `Unknown export scope "${invalidScope}". Expected: ${SCOPES.join(", ")}.`);
  }

  const fromDate = params.get("from");
  const toDate = params.get("to");
  if (fromDate !== null && !validDate(fromDate)) throw new InvalidExportQuery("invalid_date", "from must be a valid YYYY-MM-DD date.");
  if (toDate !== null && !validDate(toDate)) throw new InvalidExportQuery("invalid_date", "to must be a valid YYYY-MM-DD date.");
  if (fromDate !== null && toDate !== null && fromDate > toDate) {
    throw new InvalidExportQuery("invalid_date_range", "from must be on or before to.");
  }

  return {
    scopes: new Set(selected as ExportScope[]),
    preview: previewValue === "1",
    timeZone,
    ...(fromDate === null ? {} : { from: localMidnight(fromDate, timeZone) }),
    // The UI's end date is inclusive; query helpers consume a half-open end.
    ...(toDate === null ? {} : { to: localMidnight(addLocalDays(toDate, 1), timeZone) }),
  };
}

function rangeWhere(options: ExportOptions, alias: string): { sql: string; params: number[] } {
  const clauses: string[] = [];
  const params: number[] = [];
  if (options.from !== undefined) { clauses.push(`${alias}.time_created >= ?`); params.push(options.from); }
  if (options.to !== undefined) { clauses.push(`${alias}.time_created < ?`); params.push(options.to); }
  return { sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "", params };
}

function selectedSessionIds(db: DatabaseSync, options: ExportOptions): string[] {
  const range = rangeWhere(options, "s");
  return query<IdRow>(db, `SELECT s.id FROM session s${range.sql} ORDER BY s.time_created, s.id`, range.params).map((row) => row.id);
}

function exportCounts(db: DatabaseSync, options: ExportOptions): ExportManifestCounts {
  const range = rangeWhere(options, "s");
  const count = (table: "session" | "message" | "part" | "todo"): number => {
    if (table === "session") {
      return query<CountRow>(db, `SELECT COUNT(*) AS count FROM session s${range.sql}`, range.params)[0]?.count ?? 0;
    }
    return query<CountRow>(
      db,
      `SELECT COUNT(*) AS count FROM ${table} item JOIN session s ON s.id = item.session_id${range.sql}`,
      range.params,
    )[0]?.count ?? 0;
  };
  return { sessions: count("session"), messages: count("message"), parts: count("part"), todos: count("todo") };
}

function projectWorktrees(db: DatabaseSync): string[] {
  return query<WorktreeRow>(db, "SELECT worktree FROM project WHERE worktree IS NOT NULL AND worktree <> '' ORDER BY worktree")
    .map((row) => row.worktree);
}

function mcpServers(db: DatabaseSync): string[] {
  const config = readOpencodeConfig({ projectWorktrees: projectWorktrees(db) });
  return config ? redactConfig(config).mcpServers.map((server) => server.name) : [];
}

function statsData(db: DatabaseSync, options: ExportOptions): { data: OverviewStats; warnings: OcWarning[] } {
  const range = { from: options.from, to: options.to };
  const overview = getOverviewStats(db, options.timeZone, Date.now(), range);
  const costs = costBreakdown(db, readPricing(), options.timeZone, range);
  const modelCosts = new Map(costs.byModel.map((item) => [`${item.providerID}/${item.modelID}`, item.cost]));
  const projectCosts = new Map(costs.byProject.map((item) => [item.projectId, item.cost]));
  const costData = { ...costs, storedCostComparison: overview.data.storedCostComparison };
  return {
    data: {
      ...overview.data,
      totalCost: costs.totalCost,
      storedCostComparison: overview.data.storedCostComparison,
      costBreakdown: costData,
      modelBreakdown: overview.data.modelBreakdown.map((item) => ({
        ...item,
        cost: modelCosts.get(`${item.providerID}/${item.modelID}`) ?? { amount: 0, priced: false },
      })),
      projectBreakdown: overview.data.projectBreakdown.map((item) => ({
        ...item,
        cost: projectCosts.get(item.id) ?? { amount: 0, priced: false },
      })),
    },
    warnings: overview.warnings,
  };
}

function activityData(db: DatabaseSync, options: ExportOptions): { data: ActivityStats; warnings: OcWarning[] } {
  const range = { from: options.from, to: options.to, timeZone: options.timeZone };
  const daily = dailyActivity(db, range);
  const hourly = hourOfDay(db, range);
  const weekly = dayOfWeek(db, range);
  return {
    data: { dailyActivity: daily.data, hourOfDay: hourly.data, dayOfWeek: weekly.data, streaks: streaksFromRange(daily.data, generatedToday(options.timeZone)) },
    warnings: mergeWarnings([daily.warnings, hourly.warnings, weekly.warnings]),
  };
}

function generatedToday(timeZone: string): string {
  return localDay(Date.now(), timeZone);
}

function streaksFromRange(activity: ActivityStats["dailyActivity"], today: string): StreakSummary {
  const dates = activity.filter((day) => day.sessionCount > 0).map((day) => day.date).sort();
  if (dates.length === 0) {
    return { currentStreakDays: 0, longestStreakDays: 0, longestStreakStart: null, longestStreakEnd: null, mostActiveDay: null, totalActiveDays: 0, firstSessionDate: null };
  }
  let longest = 1;
  let run = 1;
  let runStart = dates[0]!;
  let longestStart = dates[0]!;
  let longestEnd = dates[0]!;
  for (let index = 1; index < dates.length; index += 1) {
    if (dates[index] === addLocalDays(dates[index - 1]!, 1)) run += 1;
    else { run = 1; runStart = dates[index]!; }
    if (run > longest) { longest = run; longestStart = runStart; longestEnd = dates[index]!; }
  }
  const dateSet = new Set(dates);
  let cursor = today;
  let current = 0;
  while (dateSet.has(cursor)) { current += 1; cursor = addLocalDays(cursor, -1); }
  const mostActiveDay = [...activity]
    .filter((day) => day.sessionCount > 0)
    .sort((a, b) => (b.sessionCount + b.messageCount + b.toolCallCount) - (a.sessionCount + a.messageCount + a.toolCallCount) || a.date.localeCompare(b.date))[0]?.date ?? null;
  return { currentStreakDays: current, longestStreakDays: longest, longestStreakStart: longestStart, longestStreakEnd: longestEnd, mostActiveDay, totalActiveDays: dates.length, firstSessionDate: dates[0]! };
}

function toolsData(db: DatabaseSync, options: ExportOptions, servers: string[]): { data: ToolsStats; warnings: OcWarning[] } {
  // OCL-015's part/version filters use an inclusive `to`; the export contract
  // is half-open, so subtract one millisecond at this adapter boundary.
  const range = { from: options.from, to: options.to === undefined ? undefined : options.to - 1 };
  const tools = toolUsage(db, range);
  return {
    data: {
      tools: tools.data,
      errors: toolErrors(db, range).data,
      activity: toolActivity(db, range, options.timeZone).data,
      mcpServers: mcpUsage(db, servers, range).data,
      skills: skillUsage(db, range).data,
      featureAdoption: featureAdoption(db, servers, range).data,
      versionHistory: versionHistory(db, range).data,
    },
    warnings: tools.warnings,
  };
}

function todosData(db: DatabaseSync, selectedIds: Set<string>): { data: TodosResponse; warnings: OcWarning[] } {
  const todos = readTodos(db);
  const sessions = todos.data.sessions.filter((session) => selectedIds.has(session.sessionId));
  const rollup = { pending: 0, inProgress: 0, completed: 0, unknown: 0 };
  for (const session of sessions) {
    rollup.pending += session.rollup.pending;
    rollup.inProgress += session.rollup.inProgress;
    rollup.completed += session.rollup.completed;
    rollup.unknown += session.rollup.unknown;
  }
  return { data: { sessions, rollup }, warnings: todos.warnings };
}

function previewResponse(counts: ExportManifestCounts, options: ExportOptions, generatedAt: number): NextResponse<ExportRouteResponse> {
  const data: ExportResponse = {
    generatedAt,
    schemaVersion,
    rangeFrom: options.from ?? null,
    rangeTo: options.to ?? null,
    counts,
  };
  return NextResponse.json({ data, meta: { generatedAt, schemaVersion, warnings: [] } });
}

function* boundedEncode(encoder: TextEncoder, value: string): Generator<Uint8Array> {
  for (let offset = 0; offset < value.length; offset += STREAM_TEXT_CHARS) {
    yield encoder.encode(value.slice(offset, offset + STREAM_TEXT_CHARS));
  }
}

function zeroTokens(): OcTokens {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

function addTokens(target: OcTokens, source: OcTokens): void {
  target.input += source.input;
  target.output += source.output;
  target.reasoning += source.reasoning;
  target.cacheRead += source.cacheRead;
  target.cacheWrite += source.cacheWrite;
}

function replaySummary(
  db: DatabaseSync,
  id: string,
  servers: string[],
  warnings: OcWarning[][],
): { summary: SessionSummary; messages: Array<{ row: ReplayMessageRow; decoded: ReturnType<typeof decodeMessageData>["value"] }>; childIds: string[] } | null {
  const session = query<ReplaySessionRow>(db, `
    SELECT s.id, s.project_id, s.parent_id, s.slug, s.directory, s.title, s.version,
      s.agent, s.model, s.time_created, s.time_updated, s.time_archived,
      s.tokens_input, s.tokens_output, s.tokens_reasoning, s.tokens_cache_read, s.tokens_cache_write,
      p.name AS project_name, p.worktree AS project_worktree
    FROM session s LEFT JOIN project p ON p.id = s.project_id WHERE s.id = ?
  `, [id])[0];
  if (!session) return null;

  const messageRows = query<ReplayMessageRow>(db, "SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id", [id]);
  const messages = messageRows.map((row) => {
    const decoded = decodeMessageData(row.data);
    warnings.push(decoded.warnings);
    return { row, decoded: decoded.value };
  });
  const firstUserId = messages.find((message) => message.decoded.role === "user")?.row.id;
  const firstTextRaw = firstUserId === undefined ? undefined : query<{ data: string | null }>(db, `
    SELECT data FROM part
    WHERE message_id = ? AND json_valid(data) AND json_extract(data, '$.type') = 'text'
      AND trim(COALESCE(json_extract(data, '$.text'), '')) <> ''
    ORDER BY time_created, id LIMIT 1
  `, [firstUserId])[0]?.data;
  const firstText = firstTextRaw === undefined ? null : decodePartData(firstTextRaw);
  if (firstText) warnings.push(firstText.warnings);

  const flags = query<PartFlagsRow>(db, `
    SELECT
      COALESCE(SUM(CASE WHEN json_valid(data) AND json_extract(data, '$.type') = 'tool' THEN 1 ELSE 0 END), 0) AS tool_count,
      COALESCE(SUM(CASE WHEN json_valid(data) AND json_extract(data, '$.type') = 'tool' AND json_extract(data, '$.state.status') = 'error' THEN 1 ELSE 0 END), 0) AS error_count,
      COALESCE(MAX(CASE WHEN json_valid(data) AND json_extract(data, '$.type') = 'reasoning' THEN 1 ELSE 0 END), 0) AS has_reasoning,
      COALESCE(MAX(CASE WHEN json_valid(data) AND json_extract(data, '$.type') = 'tool' AND json_extract(data, '$.tool') = 'task' THEN 1 ELSE 0 END), 0) AS uses_task,
      COALESCE(MAX(CASE WHEN json_valid(data) AND json_extract(data, '$.type') = 'tool' AND json_extract(data, '$.tool') = 'webfetch' THEN 1 ELSE 0 END), 0) AS uses_webfetch
    FROM part WHERE session_id = ?
  `, [id])[0] ?? { tool_count: 0, error_count: 0, has_reasoning: 0, uses_task: 0, uses_webfetch: 0 };
  const toolNames = query<ToolNameRow>(db, `
    SELECT DISTINCT json_extract(data, '$.tool') AS tool FROM part
    WHERE session_id = ? AND json_valid(data) AND json_extract(data, '$.type') = 'tool'
      AND typeof(json_extract(data, '$.tool')) = 'text'
  `, [id]);
  const childIds = query<IdRow>(db, "SELECT id FROM session WHERE parent_id = ? ORDER BY time_created, id", [id]).map((row) => row.id);
  const model = decodeSessionModel(session.model);
  warnings.push(model.warnings);
  const fallbackText = firstText?.value.type === "text" ? firstText.value.text.trim() : "";
  const title = isPlaceholderTitle(session.title) ? (fallbackText || session.slug) : session.title;
  const summary: SessionSummary = {
    id: session.id,
    slug: session.slug,
    title,
    projectId: session.project_id,
    projectDisplayName: projectDisplayName(session.project_id, session.project_name, session.project_worktree),
    directory: session.directory,
    agent: session.agent,
    model: model.value,
    version: session.version,
    timeCreated: session.time_created,
    timeUpdated: session.time_updated,
    durationMs: session.time_updated >= session.time_created ? session.time_updated - session.time_created : null,
    timeArchived: session.time_archived,
    parentId: session.parent_id,
    messageCounts: {
      user: messages.filter((message) => message.decoded.role === "user").length,
      assistant: messages.filter((message) => message.decoded.role === "assistant").length,
    },
    toolCallCount: flags.tool_count,
    errorCount: flags.error_count,
    tokens: {
      input: session.tokens_input ?? 0,
      output: session.tokens_output ?? 0,
      reasoning: session.tokens_reasoning ?? 0,
      cacheRead: session.tokens_cache_read ?? 0,
      cacheWrite: session.tokens_cache_write ?? 0,
    },
    cost: { amount: 0, priced: false },
    hasReasoning: flags.has_reasoning > 0,
    hasCompaction: false,
    usesMcp: toolNames.some((row) => resolveMcpTool(row.tool, servers) !== null),
    usesSubagent: flags.uses_task > 0 || childIds.length > 0,
    usesWebfetch: flags.uses_webfetch > 0,
  };
  return { summary, messages, childIds };
}

function* streamReplay(
  db: DatabaseSync,
  id: string,
  servers: string[],
  warnings: OcWarning[][],
  encoder: TextEncoder,
): Generator<Uint8Array> {
  const replay = replaySummary(db, id, servers, warnings);
  if (!replay) return;
  yield* boundedEncode(encoder, `{"session":${JSON.stringify(replay.summary)},"parentId":${JSON.stringify(replay.summary.parentId)},"childIds":${JSON.stringify(replay.childIds)},"turns":[`);
  const accumulation = zeroTokens();
  const tokenAccumulation: Array<{ atTurnIndex: number; tokens: OcTokens }> = [];

  for (let turnIndex = 0; turnIndex < replay.messages.length; turnIndex += 1) {
    const message = replay.messages[turnIndex]!;
    const created = message.decoded.timeCreated ?? message.row.time_created;
    const completed = message.decoded.timeCompleted;
    const turnPrefix = JSON.stringify({
      messageId: message.row.id,
      role: message.decoded.role,
      agent: message.decoded.agent,
      timeCreated: created,
      timeCompleted: completed,
      durationMs: completed === null ? null : completed - created,
      tokens: message.decoded.tokens,
      cost: { amount: 0, priced: false },
    });
    yield* boundedEncode(encoder, `${turnIndex === 0 ? "" : ","}${turnPrefix.slice(0, -1)},"parts":[`);

    let lastTime: number | null = null;
    let lastId = "";
    let firstPart = true;
    while (true) {
      const page: ReplayPartRow[] = lastTime === null
        ? query<ReplayPartRow>(db, "SELECT id, time_created, data FROM part WHERE message_id = ? ORDER BY time_created, id LIMIT ?", [message.row.id, PART_PAGE_SIZE])
        : query<ReplayPartRow>(db, "SELECT id, time_created, data FROM part WHERE message_id = ? AND (time_created > ? OR (time_created = ? AND id > ?)) ORDER BY time_created, id LIMIT ?", [message.row.id, lastTime, lastTime, lastId, PART_PAGE_SIZE]);
      if (page.length === 0) break;
      for (const row of page) {
        const decoded = decodePartData(row.data);
        warnings.push(decoded.warnings);
        if (decoded.value.type === "step-finish" && decoded.value.tokens) addTokens(accumulation, decoded.value.tokens);
        yield* boundedEncode(encoder, `${firstPart ? "" : ","}${JSON.stringify({ id: row.id, data: decoded.value })}`);
        firstPart = false;
      }
      const last: ReplayPartRow = page[page.length - 1]!;
      lastTime = last.time_created;
      lastId = last.id;
      if (page.length < PART_PAGE_SIZE) break;
    }
    yield* boundedEncode(encoder, "]}");
    tokenAccumulation.push({ atTurnIndex: turnIndex, tokens: { ...accumulation } });
  }
  yield* boundedEncode(encoder, `],"tokenAccumulation":${JSON.stringify(tokenAccumulation)}}`);
}

function streamedResponse(
  db: DatabaseSync,
  options: ExportOptions,
  counts: ExportManifestCounts,
  ids: string[],
  generatedAt: number,
): Response {
  const encoder = new TextEncoder();
  const warnings: OcWarning[][] = [];
  const selectedIds = new Set(ids);

  async function* jsonChunks(): AsyncGenerator<Uint8Array> {
    const emit = (value: string): Uint8Array => encoder.encode(value);
    yield emit(`{"data":{"generatedAt":${generatedAt},"schemaVersion":${JSON.stringify(schemaVersion)},"rangeFrom":${options.from ?? "null"},"rangeTo":${options.to ?? "null"},"counts":${JSON.stringify(counts)}`);

    if (options.scopes.has("sessions")) {
      const result = listSessions(db, { from: options.from, to: options.to });
      warnings.push(result.warnings);
      yield emit(`,"sessions":${JSON.stringify(result.data)}`);
    }
    if (options.scopes.has("stats")) {
      const result = statsData(db, options);
      warnings.push(result.warnings);
      yield emit(`,"stats":${JSON.stringify(result.data)}`);
    }
    if (options.scopes.has("activity")) {
      const result = activityData(db, options);
      warnings.push(result.warnings);
      yield emit(`,"activity":${JSON.stringify(result.data)}`);
    }
    if (options.scopes.has("tools")) {
      const result = toolsData(db, options, mcpServers(db));
      warnings.push(result.warnings);
      yield emit(`,"tools":${JSON.stringify(result.data)}`);
    }
    if (options.scopes.has("todos")) {
      const result = todosData(db, selectedIds);
      warnings.push(result.warnings);
      yield emit(`,"todos":${JSON.stringify(result.data)}`);
    }
    if (options.scopes.has("replay")) {
      const servers = mcpServers(db);
      yield emit(',"replays":[');
      let first = true;
      for (const id of ids) {
        if (!first) yield emit(",");
        yield* streamReplay(db, id, servers, warnings, encoder);
        first = false;
      }
      yield emit("]");
    }
    yield emit(`},"meta":{"generatedAt":${generatedAt},"schemaVersion":${JSON.stringify(schemaVersion)},"warnings":${JSON.stringify(mergeWarnings(warnings))}}}`);
  }

  const iterator = jsonChunks();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="oc-lens-export-${new Date(generatedAt).toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  let options: ExportOptions;
  try {
    options = parseOptions(request);
  } catch (error) {
    if (error instanceof InvalidExportQuery) return errorResponse(error.code, error.message, 400);
    return errorResponse("invalid_export", "The export query is invalid.", 400);
  }

  try {
    const connection = getConnection();
    if (!connection.ok) {
      if (connection.reason === "not-found") {
        return errorResponse("database_not_found", "No opencode database was found. Check the database location in Settings.", 404);
      }
      return errorResponse("schema_mismatch", `The opencode database schema is not supported by ${schemaVersion}.`, 409);
    }
    const generatedAt = Date.now();
    const counts = exportCounts(connection.db, options);
    if (options.preview) return previewResponse(counts, options, generatedAt);
    return streamedResponse(connection.db, options, counts, selectedSessionIds(connection.db, options), generatedAt);
  } catch {
    return errorResponse("export_failed", "The export could not be read from the opencode database.", 500);
  }
}
