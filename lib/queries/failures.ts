import type { DatabaseSync } from "node:sqlite";

import { query } from "@/lib/db/connection";
import { asNumber, asRecord, asString, safeJsonParse } from "@/lib/decode/json";
import { isPlaceholderTitle } from "@/lib/decode/session";
import { decodeTokens } from "@/lib/decode/tokens";
import { costForMessageData } from "@/lib/pricing/breakdown";
import { FAILURE_KINDS, type FailedCall, type FailureIncident, type FailureKind, type FailuresReport } from "@/lib/audit/failure-types";
import type { OcTokens, PricingConfig } from "@/types/oc";

export { FAILURE_KINDS, type FailedCall, type FailureIncident, type FailureKind, type FailuresReport };

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
 * That resend usage is an upper bound on what the failure cost, never "wasted
 * spend": had the original call succeeded, it would have paid for most of the
 * same context. The part only the provider's bill can confirm is whether the
 * failed attempt itself was charged.
 */

interface MessageRow {
  id: string;
  session_id: string;
  time_created: number;
  data: string | null;
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
    case "provider.invalid-request": return "invalid-request";
    case "ProviderAuthError": return "auth";
    case "provider.error":
    case "APIError": return "provider-error";
    default: return rawType.startsWith("provider.") ? "provider-error" : "unknown";
  }
}

interface Decoded {
  role: "user" | "assistant" | "other";
  synthetic: boolean;
  providerID: string | null;
  modelID: string | null;
  tokens: OcTokens | null;
  error: { rawType: string; status: number | null; message: string | null } | null;
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

function decode(raw: string | null): Decoded {
  const parsed = safeJsonParse(raw);
  const obj = parsed.ok ? asRecord(parsed.value) : null;
  if (!obj) return { role: "other", synthetic: false, providerID: null, modelID: null, tokens: null, error: null };
  const model = asRecord(obj.model);
  return {
    role: obj.role === "user" ? "user" : obj.role === "assistant" ? "assistant" : "other",
    synthetic: obj.synthetic === true,
    providerID: asString(obj.providerID) ?? asString(model?.providerID),
    modelID: asString(obj.modelID) ?? asString(model?.modelID),
    tokens: decodeTokens(obj.tokens),
    error: decodeError(obj.error),
  };
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function localDay(epochMs: number, timeZone: string): string {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }); dayFormatters.set(timeZone, formatter); }
  return formatter.format(new Date(epochMs));
}

function emptyKinds(): Record<FailureKind, number> {
  return { "rate-limit": 0, "provider-down": 0, auth: 0, "invalid-request": 0, "provider-error": 0, aborted: 0, unknown: 0 };
}

function incidentsForSession(rows: readonly MessageRow[], title: string, config: PricingConfig): FailureIncident[] {
  const incidents: FailureIncident[] = [];
  let open: FailureIncident | null = null;
  for (const row of rows) {
    const message = decode(row.data);
    if (message.role === "assistant" && message.error) {
      const call: FailedCall = {
        messageId: row.id,
        timeCreated: row.time_created,
        providerID: message.providerID,
        modelID: message.modelID,
        kind: classifyFailure(message.error.rawType, message.error.status),
        rawType: message.error.rawType,
        status: message.error.status,
        message: message.error.message,
        tokens: anyTokens(message.tokens) ? message.tokens : null,
      };
      open ??= { sessionId: row.session_id, sessionTitle: title, firstFailureAt: row.time_created, failures: [], autoResends: 0, userResends: 0, providerFault: false, recovery: null };
      open.failures.push(call);
      if (call.kind !== "aborted") open.providerFault = true;
      continue;
    }
    if (!open) continue;
    if (message.role === "user") {
      if (message.synthetic) open.autoResends += 1;
      else open.userResends += 1;
    } else if (message.role === "assistant" && anyTokens(message.tokens)) {
      open.recovery = { messageId: row.id, timeCreated: row.time_created, providerID: message.providerID, modelID: message.modelID, tokens: message.tokens, cost: costForMessageData(row.data, config) };
      incidents.push(open);
      open = null;
    }
  }
  if (open) incidents.push(open);
  return incidents;
}

export function failureReport(db: DatabaseSync, config: PricingConfig, timeZone = "UTC", range: { from?: number; to?: number } = {}): FailuresReport {
  // Only sessions that contain a failure are scanned in full; ordering matches replay.
  const rows = query<MessageRow>(db, `
    SELECT id, session_id, time_created, data FROM message
    WHERE session_id IN (SELECT DISTINCT session_id FROM message WHERE json_extract(data, '$.error') IS NOT NULL)
    ORDER BY session_id, time_created, id
  `);
  const sessions = new Map(query<SessionRow>(db, `
    SELECT id, slug, title FROM session
    WHERE id IN (SELECT DISTINCT session_id FROM message WHERE json_extract(data, '$.error') IS NOT NULL)
  `).map((s) => [s.id, isPlaceholderTitle(s.title) ? s.slug : s.title]));

  const bySession = new Map<string, MessageRow[]>();
  for (const row of rows) {
    const list = bySession.get(row.session_id) ?? [];
    list.push(row);
    bySession.set(row.session_id, list);
  }

  const inRange = (time: number) => (range.from === undefined || time >= range.from) && (range.to === undefined || time < range.to);
  const incidents = [...bySession].flatMap(([id, list]) => incidentsForSession(list, sessions.get(id) ?? id, config))
    .filter((incident) => inRange(incident.firstFailureAt))
    .sort((left, right) => right.firstFailureAt - left.firstFailureAt);

  const summary: FailuresReport["summary"] = {
    failedCalls: 0, byKind: emptyKinds(), incidents: incidents.length, recovered: 0, autoResends: 0, userResends: 0,
    resendTokens: zeroTokens(), resendCostAmount: 0, resendUnpriced: 0, failedCallsWithUsage: 0, failedCallTokens: zeroTokens(),
  };
  const byDay = new Map<string, { date: string; total: number } & Record<FailureKind, number>>();
  for (const incident of incidents) {
    summary.autoResends += incident.autoResends;
    summary.userResends += incident.userResends;
    for (const call of incident.failures) {
      summary.failedCalls += 1;
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
  return { summary, byDay: [...byDay.values()].sort((left, right) => left.date.localeCompare(right.date)), incidents };
}
