import type { DatabaseSync } from "node:sqlite";

import { query } from "@/lib/db/connection";
import { asNumber, asRecord, asString, safeJsonParse } from "@/lib/decode/json";
import { isPlaceholderTitle } from "@/lib/decode/session";
import { decodeTokens } from "@/lib/decode/tokens";
import { callSignature } from "@/lib/loops/signature";
import { costForMessageData } from "@/lib/pricing/breakdown";
import { costFor } from "@/lib/pricing/cost";
import {
  FAILURE_KINDS,
  type FailedCall,
  type FailureIncident,
  type FailureKind,
  type FailureOverhead,
  type FailuresReport,
  type SessionFailureReport,
} from "@/lib/audit/failure-types";
import type { OcCost, OcTokens, PricingConfig } from "@/types/oc";

export { FAILURE_KINDS, type FailedCall, type FailureIncident, type FailureKind, type FailuresReport, type SessionFailureReport };

/**
 * Provider failures and what resending after them cost (data-model §8.7).
 *
 * opencode saves a model call that finally failed as an assistant step with an
 * `error`. It does **not** save the retries it schedules inside a step
 * (`session.retry.scheduled` is never persisted), so those attempts are
 * invisible here. What is visible: the failed step, opencode's automatic
 * resends (`synthetic` turns), the user's own resends, and the first step that
 * succeeded afterwards — whose usage is what the resend paid.
 *
 * Failed calls normally record no usage, so subtracting them from a session's
 * total changes nothing. What a failure adds shows up afterwards, and is
 * measured as three separate things rather than one "waste" figure:
 *
 * - usage recorded on the failed call itself (certain, normally zero);
 * - cache lost: context the step before the failure read from cache but the
 *   recovery paid at the full input price — same tokens, higher price;
 * - repeated calls: tool calls after the recovery that exactly repeat one from
 *   the failed turn (tool + input hash, the loop detector's signature).
 *
 * The recovery's whole usage is never called waste: had the original call
 * succeeded it would have paid for most of the same context. Whether the failed
 * attempt itself was charged only the provider's bill can confirm.
 */

interface MessageRow {
  id: string;
  session_id: string;
  time_created: number;
  data: string | null;
}

interface ToolPartRow {
  id: string;
  message_id: string;
  data: string | null;
}

interface ToolCall {
  partId: string;
  tool: string;
  signature: string | null;
}

interface SessionRow {
  id: string;
  slug: string;
  title: string;
}

const MESSAGE_CHARS = 300;

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

function anyTokens(tokens: OcTokens | null): tokens is OcTokens {
  return tokens !== null && tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite > 0;
}

/** HTTP status first (it is the provider's own word), then opencode's label. Unrecognised labels stay visible as `unknown`. */
export function classifyFailure(rawType: string, status: number | null): FailureKind {
  if (rawType === "aborted" || rawType === "MessageAbortedError") return "aborted";
  if (status === 429) return "rate-limit";
  if (status !== null && status >= 500) return "provider-down";
  if (status === 401 || status === 403) return "auth";
  if (status !== null && status >= 400) return "invalid-request";
  switch (rawType) {
    case "provider.rate-limit": return "rate-limit";
    case "provider.internal": return "provider-down";
    case "provider.transport": return "transport";
    case "provider.invalid-request": return "invalid-request";
    case "ProviderAuthError": return "auth";
    case "provider.error":
    case "APIError": return "provider-error";
    default: return rawType.startsWith("provider.") ? "provider-error" : "unknown";
  }
}

interface Decoded {
  role: "user" | "assistant" | "other";
  synthetic: string | null; // injector of a synthetic turn (canonical view), null on real user turns
  providerID: string | null;
  modelID: string | null;
  tokens: OcTokens | null;
  error: { rawType: string; status: number | null; message: string | null } | null;
  retry: { attempt: number; error: Decoded["error"] } | null;
}

// 2.x (projected by lib/db/canonical.ts): error{type, message, status?}.
// 1.x: error{name, data{message, statusCode?, isRetryable?, responseHeaders?, responseBody?}} — data-model §4.
function decodeError(raw: unknown): Decoded["error"] {
  const error = asRecord(raw);
  if (!error) return null;
  const data = asRecord(error.data);
  const rawType = asString(error.type) ?? asString(error.name) ?? "unknown";
  const status = asNumber(error.status) ?? asNumber(data?.statusCode) ?? null;
  const message = asString(error.message) ?? asString(data?.message);
  return { rawType, status, message: message === null ? null : message.slice(0, MESSAGE_CHARS) };
}

// 2.x `retry{attempt, at, error{type, message, status}}` — the last retry opencode scheduled in a step (data-model §8.7).
function decodeRetry(raw: unknown): Decoded["retry"] {
  const retry = asRecord(raw);
  const attempt = asNumber(retry?.attempt);
  if (!retry || attempt === null || attempt < 1) return null;
  return { attempt, error: decodeError(retry.error) };
}

function accepted(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

function failedCall(row: MessageRow, message: Decoded, error: NonNullable<Decoded["error"]>, succeeded: boolean): FailedCall {
  const status = error.status ?? message.retry?.error?.status ?? null;
  return {
    messageId: row.id,
    timeCreated: row.time_created,
    providerID: message.providerID,
    modelID: message.modelID,
    kind: classifyFailure(error.rawType, status),
    rawType: error.rawType,
    status,
    message: error.message,
    tokens: succeeded || !anyTokens(message.tokens) ? null : message.tokens,
    retries: message.retry?.attempt ?? null,
    accepted: accepted(status),
    succeeded,
  };
}

function decode(raw: string | null): Decoded {
  const parsed = safeJsonParse(raw);
  const obj = parsed.ok ? asRecord(parsed.value) : null;
  if (!obj) return { role: "other", synthetic: null, providerID: null, modelID: null, tokens: null, error: null, retry: null };
  const model = asRecord(obj.model);
  return {
    role: obj.role === "user" ? "user" : obj.role === "assistant" ? "assistant" : "other",
    synthetic: asString(obj.synthetic),
    providerID: asString(obj.providerID) ?? asString(model?.providerID),
    modelID: asString(obj.modelID) ?? asString(model?.modelID),
    tokens: decodeTokens(obj.tokens),
    error: decodeError(obj.error),
    retry: decodeRetry(obj.retry),
  };
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function localDay(epochMs: number, timeZone: string): string {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }); dayFormatters.set(timeZone, formatter); }
  return formatter.format(new Date(epochMs));
}

function emptyKinds(): Record<FailureKind, number> {
  return { "rate-limit": 0, "provider-down": 0, transport: 0, auth: 0, "invalid-request": 0, "provider-error": 0, aborted: 0, unknown: 0 };
}

interface Located {
  incident: FailureIncident;
  turnStart: number; // index of the real user message that started the failed turn
  recoveryIndex: number | null;
}

function zeroCost(): OcCost {
  return { amount: 0, priced: false };
}

/** The price difference between paying `tokens` as fresh input and reading them from cache. */
function cacheLossCost(tokens: number, providerID: string | null, modelID: string | null, config: PricingConfig): OcCost {
  if (!providerID || !modelID) return zeroCost();
  const key = `${providerID}/${modelID}`;
  const asInput = costFor({ ...zeroTokens(), input: tokens }, key, config);
  const asCache = costFor({ ...zeroTokens(), cacheRead: tokens }, key, config);
  return asInput.priced && asCache.priced ? { amount: Math.max(0, asInput.amount - asCache.amount), priced: true } : zeroCost();
}

function contextSize(tokens: OcTokens): number {
  return tokens.input + tokens.cacheRead + tokens.cacheWrite;
}

/** Accepted attempts with no recorded usage: a failed step made at least max(1, retries); a step that succeeded made `retries` failed ones. */
function acceptedUnrecorded(incident: FailureIncident): FailureIncident["acceptedUnrecorded"] {
  const requests = incident.failures.filter((call) => call.accepted && call.tokens === null)
    .reduce((sum, call) => sum + (call.succeeded ? call.retries ?? 0 : Math.max(1, call.retries ?? 1)), 0);
  if (requests === 0) return null;
  const tokensPerRequest = incident.before ? contextSize(incident.before.tokens) : null;
  return { requests, tokensPerRequest, tokens: tokensPerRequest === null ? null : requests * tokensPerRequest };
}

function locateIncidents(rows: readonly MessageRow[], title: string, config: PricingConfig): Located[] {
  const located: Located[] = [];
  let open: Located | null = null;
  let turnStart = 0;
  let previousFailed = false;
  let lastSuccess: { messageId: string; tokens: OcTokens; providerID: string | null; modelID: string | null } | null = null;
  const openIncident = (row: MessageRow) => {
    open ??= {
      incident: {
        sessionId: row.session_id, sessionTitle: title, firstFailureAt: row.time_created, failures: [], autoResends: 0, userResends: 0,
        providerFault: false, recovery: null, resends: [], before: lastSuccess && { messageId: lastSuccess.messageId, tokens: lastSuccess.tokens },
        cacheLost: null, repeatedCalls: [], acceptedUnrecorded: null,
      },
      turnStart,
      recoveryIndex: null,
    };
    return open;
  };
  const record = (entry: Located, call: FailedCall) => {
    entry.incident.failures.push(call);
    if (call.kind !== "aborted") entry.incident.providerFault = true;
  };
  rows.forEach((row, index) => {
    const message = decode(row.data);
    const wasFailed = previousFailed;
    previousFailed = false;
    if (message.role === "assistant" && message.error) {
      record(openIncident(row), failedCall(row, message, message.error, false));
      previousFailed = true;
      return;
    }
    if (message.role === "user" && message.synthetic === null && !open) turnStart = index;
    if (message.role === "assistant" && anyTokens(message.tokens)) {
      // A step that retried and then succeeded hid its failures inside itself: it is its own incident and its own recovery.
      if (message.retry) record(openIncident(row), failedCall(row, message, message.retry.error ?? { rawType: "unknown", status: null, message: null }, true));
      const success = { messageId: row.id, tokens: message.tokens, providerID: message.providerID, modelID: message.modelID };
      const current: Located | null = open;
      if (current) {
        const incident = current.incident;
        incident.recovery = { messageId: row.id, timeCreated: row.time_created, providerID: message.providerID, modelID: message.modelID, tokens: message.tokens, cost: costForMessageData(row.data, config) };
        const baseline = lastSuccess;
        if (baseline && baseline.providerID === message.providerID && baseline.modelID === message.modelID) {
          const lost = Math.min(Math.max(0, baseline.tokens.cacheRead - message.tokens.cacheRead), message.tokens.input);
          incident.cacheLost = { tokens: lost, extraCost: cacheLossCost(lost, message.providerID, message.modelID, config) };
        }
        incident.acceptedUnrecorded = acceptedUnrecorded(incident);
        current.recoveryIndex = index;
        located.push(current);
        open = null;
      }
      lastSuccess = success;
      return;
    }
    if (open && message.role === "user") {
      const entry: Located = open;
      // opencode also injects synthetic turns for agent switches and subagent results;
      // only its own one directly after a failed step is a resend ("continue from where you left off").
      if (message.synthetic !== null) {
        if (wasFailed && message.synthetic === "opencode") { entry.incident.resends.push({ messageId: row.id, by: "opencode" }); entry.incident.autoResends += 1; }
      } else {
        entry.incident.resends.push({ messageId: row.id, by: "you" });
        entry.incident.userResends += 1;
      }
    }
  });
  // `open` is reassigned inside the callback, which TypeScript's narrowing cannot see.
  const last = open as Located | null;
  if (last) {
    last.incident.acceptedUnrecorded = acceptedUnrecorded(last.incident);
    located.push(last);
  }
  return located;
}

/**
 * Marks tool calls after a recovery that repeat a call from the failed turn.
 * The comparison window ends at the user's next real message: a later turn
 * repeating a call is new work, not a redo.
 */
function markRepeatedCalls(rows: readonly MessageRow[], located: readonly Located[], toolsByMessage: ReadonlyMap<string, readonly ToolCall[]>): void {
  for (const { incident, turnStart, recoveryIndex } of located) {
    if (recoveryIndex === null) continue;
    const firstFailure = rows.findIndex((row) => row.id === incident.failures[0]?.messageId);
    const earlier = new Map<string, string>();
    for (let index = turnStart; index < firstFailure; index += 1) {
      for (const call of toolsByMessage.get(rows[index]?.id ?? "") ?? []) if (call.signature && !earlier.has(call.signature)) earlier.set(call.signature, call.partId);
    }
    for (let index = recoveryIndex; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row) break;
      if (index > recoveryIndex) {
        const message = decode(row.data);
        if (message.role === "user" && !message.synthetic) break;
      }
      for (const call of toolsByMessage.get(row.id) ?? []) {
        const originalPartId = call.signature ? earlier.get(call.signature) : undefined;
        if (originalPartId) incident.repeatedCalls.push({ partId: call.partId, messageId: row.id, tool: call.tool, originalPartId });
      }
    }
  }
}

function toolCallsByMessage(rows: readonly ToolPartRow[]): Map<string, ToolCall[]> {
  const byMessage = new Map<string, ToolCall[]>();
  for (const row of rows) {
    const parsed = safeJsonParse(row.data);
    const data = parsed.ok ? asRecord(parsed.value) : null;
    const tool = asString(data?.tool);
    if (!data || !tool) continue;
    const list = byMessage.get(row.message_id) ?? [];
    list.push({ partId: row.id, tool, signature: callSignature(tool, asRecord(data.state)?.input) });
    byMessage.set(row.message_id, list);
  }
  return byMessage;
}

function analyseSessions(db: DatabaseSync, config: PricingConfig, sessionIds: readonly string[]): FailureIncident[] {
  if (sessionIds.length === 0) return [];
  const placeholders = sessionIds.map(() => "?").join(",");
  const rows = query<MessageRow>(db, `SELECT id, session_id, time_created, data FROM message WHERE session_id IN (${placeholders}) ORDER BY session_id, time_created, id`, sessionIds);
  const tools = toolCallsByMessage(query<ToolPartRow>(db, `SELECT id, message_id, data FROM part WHERE session_id IN (${placeholders}) AND json_extract(data, '$.type') = 'tool' ORDER BY time_created, id`, sessionIds));
  const titles = new Map(query<SessionRow>(db, `SELECT id, slug, title FROM session WHERE id IN (${placeholders})`, sessionIds)
    .map((session) => [session.id, isPlaceholderTitle(session.title) ? session.slug : session.title]));

  const bySession = new Map<string, MessageRow[]>();
  for (const row of rows) {
    const list = bySession.get(row.session_id) ?? [];
    list.push(row);
    bySession.set(row.session_id, list);
  }
  return [...bySession].flatMap(([id, list]) => {
    const located = locateIncidents(list, titles.get(id) ?? id, config);
    markRepeatedCalls(list, located, tools);
    return located.map((entry) => entry.incident);
  });
}

function failureSessionIds(db: DatabaseSync): string[] {
  return query<{ session_id: string }>(db, "SELECT DISTINCT session_id FROM message WHERE json_extract(data, '$.error') IS NOT NULL").map((row) => row.session_id);
}

function addOverhead(target: FailureOverhead, incident: FailureIncident): void {
  for (const call of incident.failures) {
    if (call.succeeded) continue;
    target.failedCalls += 1;
    if (call.tokens) addTokens(target.failedCallTokens, call.tokens);
  }
  target.repeatedCalls += incident.repeatedCalls.length;
  target.hiddenRetries += incident.failures.reduce((sum, call) => sum + (call.retries ?? 0), 0);
  if (incident.acceptedUnrecorded) {
    target.acceptedUnrecordedRequests += incident.acceptedUnrecorded.requests;
    target.acceptedUnrecordedTokens += incident.acceptedUnrecorded.tokens ?? 0;
  }
  if (incident.cacheLost && incident.cacheLost.tokens > 0) {
    target.cacheLostTokens += incident.cacheLost.tokens;
    if (incident.cacheLost.extraCost.priced) target.cacheLostExtraAmount += incident.cacheLost.extraCost.amount;
    else target.cacheLostUnpriced += 1;
  }
}

function emptyOverhead(): FailureOverhead {
  return { failedCalls: 0, failedCallTokens: zeroTokens(), cacheLostTokens: 0, cacheLostExtraAmount: 0, cacheLostUnpriced: 0, repeatedCalls: 0, hiddenRetries: 0, acceptedUnrecordedRequests: 0, acceptedUnrecordedTokens: 0 };
}

/** Every failure incident in one session, in session order, with what they added to it. */
export function sessionFailureReport(db: DatabaseSync, config: PricingConfig, sessionId: string): SessionFailureReport {
  const incidents = analyseSessions(db, config, [sessionId]).sort((left, right) => left.firstFailureAt - right.firstFailureAt);
  const overhead = emptyOverhead();
  for (const incident of incidents) addOverhead(overhead, incident);
  return { incidents, overhead };
}

export function failureReport(db: DatabaseSync, config: PricingConfig, timeZone = "UTC", range: { from?: number; to?: number } = {}): FailuresReport {
  const inRange = (time: number) => (range.from === undefined || time >= range.from) && (range.to === undefined || time < range.to);
  const incidents = analyseSessions(db, config, failureSessionIds(db))
    .filter((incident) => inRange(incident.firstFailureAt))
    .sort((left, right) => right.firstFailureAt - left.firstFailureAt);

  const summary: FailuresReport["summary"] = {
    failedCalls: 0, byKind: emptyKinds(), incidents: incidents.length, recovered: 0, autoResends: 0, userResends: 0,
    resendTokens: zeroTokens(), resendCostAmount: 0, resendUnpriced: 0, failedCallsWithUsage: 0, failedCallTokens: zeroTokens(),
    cacheLostTokens: 0, cacheLostExtraAmount: 0, cacheLostUnpriced: 0, repeatedCalls: 0, hiddenRetries: 0, acceptedUnrecordedRequests: 0, acceptedUnrecordedTokens: 0,
  };
  const overhead = emptyOverhead();
  const byDay = new Map<string, { date: string; total: number } & Record<FailureKind, number>>();
  for (const incident of incidents) {
    addOverhead(overhead, incident);
    summary.autoResends += incident.autoResends;
    summary.userResends += incident.userResends;
    for (const call of incident.failures) {
      if (!call.succeeded) summary.failedCalls += 1;
      summary.byKind[call.kind] += 1;
      if (call.tokens) { summary.failedCallsWithUsage += 1; addTokens(summary.failedCallTokens, call.tokens); }
      const date = localDay(call.timeCreated, timeZone);
      const day = byDay.get(date) ?? { date, total: 0, ...emptyKinds() };
      day.total += 1;
      day[call.kind] += 1;
      byDay.set(date, day);
    }
    if (incident.recovery) {
      summary.recovered += 1;
      if (incident.providerFault) {
        addTokens(summary.resendTokens, incident.recovery.tokens);
        if (incident.recovery.cost.priced && Number.isFinite(incident.recovery.cost.amount)) summary.resendCostAmount += incident.recovery.cost.amount;
        else summary.resendUnpriced += 1;
      }
    }
  }
  summary.cacheLostTokens = overhead.cacheLostTokens;
  summary.cacheLostExtraAmount = overhead.cacheLostExtraAmount;
  summary.cacheLostUnpriced = overhead.cacheLostUnpriced;
  summary.repeatedCalls = overhead.repeatedCalls;
  summary.hiddenRetries = overhead.hiddenRetries;
  summary.acceptedUnrecordedRequests = overhead.acceptedUnrecordedRequests;
  summary.acceptedUnrecordedTokens = overhead.acceptedUnrecordedTokens;
  return { summary, byDay: [...byDay.values()].sort((left, right) => left.date.localeCompare(right.date)), incidents };
}
