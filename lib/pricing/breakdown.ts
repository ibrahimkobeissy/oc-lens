import type { DatabaseSync } from "node:sqlite";
import { query } from "@/lib/db/connection";
import type { CostBreakdown, OcCost, OcTokens, PricingConfig } from "@/types/oc";
import { costFor, storedCostComparison } from "./cost";

interface SessionRow {
  id: string;
  project_id: string | null;
  agent: string | null;
}

interface MessageRow {
  session_id: string;
  time_created: number;
  data: string | null;
}

interface RawAssistantMessageData {
  role?: unknown;
  agent?: unknown;
  providerID?: unknown;
  modelID?: unknown;
  tokens?: {
    input?: unknown;
    output?: unknown;
    reasoning?: unknown;
    cache?: { read?: unknown; write?: unknown };
  };
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validToken(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function verifiedTokens(data: RawAssistantMessageData): OcTokens | null {
  if (!isRecord(data.tokens) || !isRecord(data.tokens.cache)) return null;
  const { input, output, reasoning } = data.tokens;
  const { read, write } = data.tokens.cache;
  if (!validToken(input) || !validToken(output) || !validToken(reasoning) || !validToken(read) || !validToken(write)) return null;
  return {
    input,
    output,
    reasoning,
    cacheRead: read,
    cacheWrite: write,
  };
}

type PricingEvidence =
  | { kind: "ignore" }
  | { kind: "invalid"; data: RawAssistantMessageData | null }
  | { kind: "assistant"; data: RawAssistantMessageData; providerID: string; modelID: string; tokens: OcTokens };

function pricingEvidence(raw: string | null): PricingEvidence {
  let parsed: unknown;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    return { kind: "invalid", data: null };
  }
  if (!isRecord(parsed)) return { kind: "invalid", data: null };
  const data = parsed as RawAssistantMessageData;
  if (data.role === "user") return { kind: "ignore" };
  const hasPricingFields = data.providerID !== undefined || data.modelID !== undefined || data.tokens !== undefined;
  if (data.role !== "assistant") return hasPricingFields ? { kind: "invalid", data } : { kind: "ignore" };
  const providerID = typeof data.providerID === "string" ? data.providerID.trim() : "";
  const modelID = typeof data.modelID === "string" ? data.modelID.trim() : "";
  const tokens = verifiedTokens(data);
  return providerID && modelID && tokens
    ? { kind: "assistant", data, providerID, modelID, tokens }
    : { kind: "invalid", data };
}

/** Prices one turn only when its raw payload proves an assistant role, model identity, and complete native token shape. */
export function costForMessageData(raw: string | null, config: PricingConfig): OcCost {
  const evidence = pricingEvidence(raw);
  return evidence.kind === "assistant"
    ? costFor(evidence.tokens, `${evidence.providerID}/${evidence.modelID}`, config)
    : { amount: 0, priced: false };
}

/** `YYYY-MM-DD` for `epochMs` in `timeZone`, without pulling in a date library. */
function localDay(epochMs: number, timeZone: string): string {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }); dayFormatters.set(timeZone, formatter); }
  return formatter.format(new Date(epochMs));
}

/**
 * A rollup bucket's running cost. `priced` stays true only when every
 * contributing model is priced; `hasEntries` distinguishes an honestly
 * priced zero-usage bucket from an empty aggregate.
 */
interface Bucket {
  amount: number;
  priced: boolean;
  hasEntries: boolean;
}

function addToBucket(map: Map<string, Bucket>, key: string, cost: OcCost): void {
  const existing = map.get(key) ?? { amount: 0, priced: true, hasEntries: false };
  existing.amount += cost.amount;
  existing.priced = existing.priced && cost.priced;
  existing.hasEntries = true;
  map.set(key, existing);
}

function completeCost(bucket: Bucket): OcCost {
  return bucket.hasEntries && bucket.priced
    ? { amount: bucket.amount, priced: true }
    : { amount: 0, priced: false };
}

function bucketsToCostArray<K extends string>(
  map: Map<string, Bucket>,
  keyField: K,
): Array<Record<K, string> & { cost: OcCost }> {
  return Array.from(map.entries()).map(([key, bucket]) => ({
    [keyField]: key,
    cost: completeCost(bucket),
  })) as Array<Record<K, string> & { cost: OcCost }>;
}

/**
 * Rolls opencode's assistant-message usage up into `CostBreakdown`, applying
 * the user's prices per `providerID/modelID` (D3). `timeZone` controls the
 * `byDay` bucketing (default UTC) — same IANA-zone convention the rest of the
 * product's time-series queries use.
 */
const ID_CHUNK_SIZE = 800;

/** Chunks `ids` at SQLite's practical bound-parameter comfort zone and unions the results. */
function queryForIds<T>(db: DatabaseSync, select: string, idColumn: string, ids: readonly string[]): T[] {
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += ID_CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + ID_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    rows.push(...query<T>(db, `${select} WHERE ${idColumn} IN (${placeholders})`, chunk));
  }
  return rows;
}

/**
 * @param sessionIds When provided, scopes the underlying `session`/`message` scans to
 * only these ids instead of the whole database (code-review-2026-08-02.md M2: callers
 * like `listSessions` that only need cost for one page of sessions previously forced a
 * full-DB, full-JSON-decode pass on every request regardless of page size).
 * `storedCostComparison` remains all-time-only regardless — no caller needs it scoped
 * to a session-id list today, and inventing that would add complexity nothing exercises.
 */
export function costBreakdown(
  db: DatabaseSync,
  config: PricingConfig,
  timeZone = "UTC",
  range: { from?: number; to?: number } = {},
  sessionIds?: readonly string[],
): CostBreakdown {
  const sessions = sessionIds === undefined
    ? query<SessionRow>(db, "SELECT id, project_id, agent FROM session")
    : queryForIds<SessionRow>(db, "SELECT id, project_id, agent FROM session", "id", sessionIds);
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const byModelTokens = new Map<string, { providerID: string; modelID: string; tokens: OcTokens }>();
  const byProject = new Map<string, Bucket>();
  const byDay = new Map<string, Bucket>();
  const bySession = new Map<string, Bucket>();
  const byAgent = new Map<string, Bucket>();
  const forcedUnpricedModels = new Set<string>();
  const total: Bucket = { amount: 0, priced: true, hasEntries: false };

  const addIncompleteEvidence = (message: MessageRow, data: RawAssistantMessageData | null): void => {
    const session = sessionById.get(message.session_id);
    const tokens = data === null ? null : verifiedTokens(data);
    const providerID = typeof data?.providerID === "string" && data.providerID.trim() ? data.providerID.trim() : "unknown";
    const modelID = typeof data?.modelID === "string" && data.modelID.trim() ? data.modelID.trim() : "unknown";
    const key = `${providerID}/${modelID}`;
    const modelEntry = byModelTokens.get(key) ?? { providerID, modelID, tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 } };
    const knownTokens = tokens ?? { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
    modelEntry.tokens.input += knownTokens.input;
    modelEntry.tokens.output += knownTokens.output;
    modelEntry.tokens.reasoning += knownTokens.reasoning;
    modelEntry.tokens.cacheRead += knownTokens.cacheRead;
    modelEntry.tokens.cacheWrite += knownTokens.cacheWrite;
    byModelTokens.set(key, modelEntry);
    forcedUnpricedModels.add(key);
    const unpriced: OcCost = { amount: 0, priced: false };
    total.priced = false;
    total.hasEntries = true;
    addToBucket(byProject, session?.project_id ?? "unknown", unpriced);
    addToBucket(byDay, localDay(message.time_created, timeZone), unpriced);
    addToBucket(bySession, message.session_id, unpriced);
    const agent = data?.role === "assistant" && typeof data.agent === "string" && data.agent.trim().length > 0 ? data.agent.trim() : "unknown";
    addToBucket(byAgent, agent, unpriced);
  };

  const messages = sessionIds === undefined
    ? query<MessageRow>(db, "SELECT session_id, time_created, data FROM message")
    : queryForIds<MessageRow>(db, "SELECT session_id, time_created, data FROM message", "session_id", sessionIds);
  for (const message of messages) {
    if ((range.from !== undefined && message.time_created < range.from) || (range.to !== undefined && message.time_created >= range.to)) continue;
    const evidence = pricingEvidence(message.data);
    if (evidence.kind === "ignore") continue;
    if (evidence.kind === "invalid") {
      addIncompleteEvidence(message, evidence.data);
      continue;
    }

    const { data, providerID, modelID, tokens } = evidence;
    const key = `${providerID}/${modelID}`;
    const cost = costFor(tokens, key, config);

    total.amount += cost.amount;
    total.priced = total.priced && cost.priced;
    total.hasEntries = true;

    const modelEntry = byModelTokens.get(key) ?? {
      providerID,
      modelID,
      tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    };
    modelEntry.tokens.input += tokens.input;
    modelEntry.tokens.output += tokens.output;
    modelEntry.tokens.reasoning += tokens.reasoning;
    modelEntry.tokens.cacheRead += tokens.cacheRead;
    modelEntry.tokens.cacheWrite += tokens.cacheWrite;
    byModelTokens.set(key, modelEntry);

    const session = sessionById.get(message.session_id);
    addToBucket(byProject, session?.project_id ?? "unknown", cost);
    addToBucket(byDay, localDay(message.time_created, timeZone), cost);
    addToBucket(bySession, message.session_id, cost);
    const agent = typeof data.agent === "string" && data.agent.trim().length > 0 ? data.agent : "unknown";
    addToBucket(byAgent, agent, cost);
  }

  return {
    totalCost: completeCost(total),
    storedCostComparison: storedCostComparison(db),
    byModel: Array.from(byModelTokens.entries()).map(([key, m]) => ({
      providerID: m.providerID,
      modelID: m.modelID,
      tokens: m.tokens,
      cost: forcedUnpricedModels.has(key) ? { amount: 0, priced: false } : costFor(m.tokens, key, config),
    })),
    byProject: bucketsToCostArray(byProject, "projectId"),
    byDay: bucketsToCostArray(byDay, "date"),
    bySession: bucketsToCostArray(bySession, "sessionId"),
    byAgent: bucketsToCostArray(byAgent, "agent"),
  };
}
