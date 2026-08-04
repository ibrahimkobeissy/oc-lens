import type { DatabaseSync } from "node:sqlite";
import { query } from "@/lib/db/connection";
import { decodeMessageData } from "@/lib/decode/message";
import { mergeWarnings, warning } from "@/lib/decode/warnings";
import { costBreakdown } from "@/lib/pricing/breakdown";
import type { ModelUsage, OcTokens, OverviewStats, PricingConfig, ProjectSummary, SessionSummary, VersionRecord } from "@/types/oc";
import { dailyActivity, dailyTokens, hourOfDay, localDay } from "./activity";
import { listSessions, projectDisplayName, type QueryResult } from "./sessions";

interface ProjectRow { id: string; name: string | null; worktree: string | null }
interface MessageRow { session_id: string; time_created: number; data: string | null }
interface SessionProjectRow { id: string; project_id: string }
interface StoredCostRow { total: number | null }
interface VersionRow { version: string; session_count: number; message_count: number; first_seen: number; last_seen: number }

function zeroTokens(): OcTokens { return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }; }
function addTokens(target: OcTokens, source: OcTokens): void {
  target.input += source.input; target.output += source.output; target.reasoning += source.reasoning;
  target.cacheRead += source.cacheRead; target.cacheWrite += source.cacheWrite;
}

/** Project-scoped model analytics from message evidence, including model switches within one session. */
export function projectModelBreakdown(db: DatabaseSync, projectId: string, pricing: PricingConfig): QueryResult<ModelUsage[]> {
  const messages = query<MessageRow>(db, `
    SELECT m.session_id, m.time_created, m.data
    FROM message m
    JOIN session s ON s.id = m.session_id
    WHERE s.project_id = ?
    ORDER BY m.time_created, m.id
  `, [projectId]);
  const models = new Map<string, ModelUsage>();
  const sessionsByModel = new Map<string, Set<string>>();
  const warningGroups = [];
  let unknownCount = 0;

  for (const message of messages) {
    const decoded = decodeMessageData(message.data);
    warningGroups.push(decoded.warnings);
    const known = decoded.value.providerID !== null && decoded.value.modelID !== null;
    const providerID = known ? decoded.value.providerID! : "unknown";
    const modelID = known ? decoded.value.modelID! : "unknown";
    if (!known) unknownCount += 1;
    const key = `${providerID}/${modelID}`;
    const entry = models.get(key) ?? {
      providerID,
      modelID,
      sessionCount: 0,
      messageCount: 0,
      tokens: zeroTokens(),
      cost: { amount: 0, priced: false },
    };
    entry.messageCount += 1;
    if (decoded.value.tokens !== null) addTokens(entry.tokens, decoded.value.tokens);
    models.set(key, entry);
    const sessionIds = sessionsByModel.get(key) ?? new Set<string>();
    sessionIds.add(message.session_id);
    sessionsByModel.set(key, sessionIds);
  }

  if (unknownCount > 0) warningGroups.push([warning("unknown-message-model", "Messages had no complete provider/model identity", unknownCount)]);
  const projectSessionIds = query<SessionProjectRow>(db, "SELECT id, project_id FROM session WHERE project_id = ?", [projectId]).map((row) => row.id);
  const strictCosts = new Map(
    costBreakdown(db, pricing, "UTC", {}, projectSessionIds).byModel
      .map((entry) => [`${entry.providerID}/${entry.modelID}`, entry.cost]),
  );
  for (const [key, entry] of models) {
    entry.sessionCount = sessionsByModel.get(key)?.size ?? 0;
    entry.cost = strictCosts.get(key) ?? { amount: 0, priced: false };
  }
  return {
    data: [...models.values()].sort((left, right) => right.messageCount - left.messageCount || `${left.providerID}/${left.modelID}`.localeCompare(`${right.providerID}/${right.modelID}`)),
    warnings: mergeWarnings(warningGroups),
  };
}

export function listProjects(
  db: DatabaseSync,
  filter: Parameters<typeof listSessions>[1] = {},
  pricing?: PricingConfig,
  preloaded?: QueryResult<SessionSummary[]>,
): QueryResult<ProjectSummary[]> {
  const sessions = preloaded ?? listSessions(db, filter, pricing);
  const rows = query<ProjectRow>(db, "SELECT id, name, worktree FROM project ORDER BY id");
  const messages = query<MessageRow>(db, "SELECT session_id, data FROM message");
  const messageCounts = new Map<string, number>();
  for (const row of messages) messageCounts.set(row.session_id, (messageCounts.get(row.session_id) ?? 0) + 1);
  const projectCosts = pricing === undefined
    ? new Map<string, ProjectSummary["cost"]>()
    : new Map(costBreakdown(db, pricing, "UTC", {}, sessions.data.map((session) => session.id)).byProject.map((entry) => [entry.projectId, entry.cost]));
  const data = rows.map((row): ProjectSummary => {
    const matching = sessions.data.filter((session) => session.projectId === row.id);
    const tokens = zeroTokens(); matching.forEach((session) => addTokens(tokens, session.tokens));
    return {
      id: row.id, displayName: projectDisplayName(row.id, row.name, row.worktree), worktree: row.worktree ?? "",
      sessionCount: matching.length, messageCount: matching.reduce((sum, s) => sum + (messageCounts.get(s.id) ?? 0), 0),
      tokens, cost: projectCosts.get(row.id) ?? { amount: 0, priced: false },
      firstActivity: matching.length ? Math.min(...matching.map((s) => s.timeCreated)) : null,
      lastActivity: matching.length ? Math.max(...matching.map((s) => s.timeUpdated)) : null,
    };
  });
  return { data, warnings: sessions.warnings };
}

export function versionHistory(db: DatabaseSync, range: { from?: number; to?: number } = {}): QueryResult<VersionRecord[]> {
  const messageRange: string[] = [];
  const sessionRange: string[] = [];
  const params: number[] = [];
  if (range.from !== undefined) { messageRange.push("m.time_created >= ?"); params.push(range.from); }
  if (range.to !== undefined) { messageRange.push("m.time_created < ?"); params.push(range.to); }
  if (range.from !== undefined) { sessionRange.push("s.time_created >= ?"); params.push(range.from); }
  if (range.to !== undefined) { sessionRange.push("s.time_created < ?"); params.push(range.to); }
  const rows = query<VersionRow>(db, `SELECT s.version AS version, COUNT(DISTINCT s.id) AS session_count,
    COUNT(m.id) AS message_count, MIN(s.time_created) AS first_seen, MAX(s.time_created) AS last_seen
    FROM session s LEFT JOIN message m ON m.session_id = s.id${messageRange.length ? ` AND ${messageRange.join(" AND ")}` : ""}
    ${sessionRange.length ? `WHERE ${sessionRange.join(" AND ")}` : ""}
    GROUP BY s.version ORDER BY last_seen DESC`, params);
  return { data: rows.map((r) => ({ version: r.version || "unknown", sessionCount: r.session_count, messageCount: r.message_count, firstSeen: r.first_seen, lastSeen: r.last_seen })), warnings: [] };
}

export function getOverviewStats(db: DatabaseSync, timeZone = "UTC", now = Date.now(), range: { from?: number; to?: number } = {}): QueryResult<OverviewStats> {
  const sessions = listSessions(db, range); const projects = listProjects(db, range, undefined, sessions); const daily = dailyActivity(db, { ...range, timeZone }); const tokensByDay = dailyTokens(db, { ...range, timeZone }); const hours = hourOfDay(db, { ...range, timeZone });
  const messages = query<MessageRow>(db, "SELECT session_id, time_created, data FROM message").filter((message) =>
    (range.from === undefined || message.time_created >= range.from) &&
    (range.to === undefined || message.time_created < range.to));
  const projectBySession = new Map(
    query<SessionProjectRow>(db, "SELECT id, project_id FROM session").map((session) => [session.id, session.project_id]),
  );
  const projectMessageCounts = new Map<string, number>();
  for (const message of messages) {
    const projectId = projectBySession.get(message.session_id) ?? "unknown";
    projectMessageCounts.set(projectId, (projectMessageCounts.get(projectId) ?? 0) + 1);
  }
  const modelMap = new Map<string, ModelUsage>(); const modelSessions = new Map<string, Set<string>>();
  // Only session-shape warnings are relevant from `listSessions`; message and
  // part rows are decoded independently below/in daily activity for the exact
  // requested event range, avoiding both out-of-range caveats and duplicates.
  const sessionWarningCodes = new Set(["unknown-agent", "unknown-model", "malformed-session-model"]);
  const warningGroups = [
    sessions.warnings.filter((warning) => sessionWarningCodes.has(warning.code)),
    daily.warnings,
  ];
  for (const row of messages) {
    const decoded = decodeMessageData(row.data); warningGroups.push(decoded.warnings);
    const providerID = decoded.value.providerID ?? "unknown"; const modelID = decoded.value.modelID ?? "unknown"; const key = `${providerID}/${modelID}`;
    const item = modelMap.get(key) ?? { providerID, modelID, sessionCount: 0, messageCount: 0, tokens: zeroTokens(), cost: { amount: 0, priced: false } };
    item.messageCount += 1; if (decoded.value.tokens) addTokens(item.tokens, decoded.value.tokens); modelMap.set(key, item);
    const seen = modelSessions.get(key) ?? new Set<string>(); seen.add(row.session_id); modelSessions.set(key, seen);
  }
  for (const [key, item] of modelMap) item.sessionCount = modelSessions.get(key)?.size ?? 0;
  const totalTokens = zeroTokens(); sessions.data.forEach((s) => addTokens(totalTokens, s.tokens));
  const today = localDay(now, timeZone); const weekStart = new Date(`${today}T00:00:00Z`); weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
  const monthStart = `${today.slice(0, 7)}-01`; const durations = sessions.data.map((s) => s.durationMs).filter((v): v is number => v !== null);
  let storedCost = 0;
  for (let offset = 0; offset < sessions.data.length; offset += 800) {
    const ids = sessions.data.slice(offset, offset + 800).map((session) => session.id);
    storedCost += query<StoredCostRow>(db, `SELECT COALESCE(SUM(cost), 0) AS total FROM session WHERE id IN (${ids.map(() => "?").join(",")})`, ids)[0]?.total ?? 0;
  }
  const emptyBreakdown = { totalCost: { amount: 0, priced: false }, storedCostComparison: storedCost, byModel: [], byProject: [], byDay: [], bySession: [], byAgent: [] };
  return { data: {
    totalSessions: sessions.data.length, totalMessages: messages.length, totalTokens, totalCost: { amount: 0, priced: false }, storedCostComparison: storedCost,
    activeDays: daily.data.filter((d) => d.sessionCount > 0).length,
    avgSessionLengthMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    sessionsThisWeek: sessions.data.filter((s) => localDay(s.timeCreated, timeZone) >= weekStart.toISOString().slice(0, 10) && localDay(s.timeCreated, timeZone) <= today).length,
    sessionsThisMonth: sessions.data.filter((s) => localDay(s.timeCreated, timeZone) >= monthStart && localDay(s.timeCreated, timeZone) <= today).length,
    unknownAgentCount: sessions.data.filter((s) => s.agent === null).length, unknownModelCount: sessions.data.filter((s) => s.model === null).length,
    modelBreakdown: Array.from(modelMap.values()).sort((a, b) => b.messageCount - a.messageCount),
    projectBreakdown: projects.data.map((project) => ({ ...project, messageCount: projectMessageCounts.get(project.id) ?? 0 })),
    dailyActivity: daily.data, dailyTokens: tokensByDay.data, hourOfDay: hours.data, costBreakdown: emptyBreakdown,
  }, warnings: mergeWarnings(warningGroups) };
}
