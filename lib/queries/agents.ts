import type { DatabaseSync } from "node:sqlite";
import { query } from "@/lib/db/connection";
import { decodeMessageData, decodePartData, mergeWarnings } from "@/lib/decode";
import { costFor } from "@/lib/pricing/cost";
import type { AgentActivityPoint, AgentSummary, AgentSwitchEvent, OcTokens, OcWarning, PricingConfig } from "@/types/oc";
import type { PartQueryFilter, QueryResult } from "./tools";

interface SessionRow { id: string; agent: string | null; project_id: string; time_created: number; time_updated: number }
interface MessageRow { id: string; session_id: string; time_created: number; data: string }
interface PartRow { message_id: string; session_id: string; data: string }
interface SwitchRow { seq: number; data: string }

interface Bucket {
  sessions: Set<string>; messageCount: number; tokens: OcTokens; costAmount: number; hasPricedUsage: boolean; allUsagePriced: boolean;
  tools: Map<string, number>; errorCount: number; durations: number[]; durationSessions: Set<string>;
}
const zeroTokens = (): OcTokens => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
function bucket(): Bucket { return { sessions: new Set(), messageCount: 0, tokens: zeroTokens(), costAmount: 0, hasPricedUsage: false, allUsagePriced: true, tools: new Map(), errorCount: 0, durations: [], durationSessions: new Set() }; }
function addTokens(a: OcTokens, b: OcTokens): void { a.input += b.input; a.output += b.output; a.reasoning += b.reasoning; a.cacheRead += b.cacheRead; a.cacheWrite += b.cacheWrite; }
function hasTokenUsage(tokens: OcTokens): boolean { return tokens.input !== 0 || tokens.output !== 0 || tokens.reasoning !== 0 || tokens.cacheRead !== 0 || tokens.cacheWrite !== 0; }
const EMPTY_PRICING: PricingConfig = { version: 1, prices: {}, updatedAt: 0 };

function included(session: SessionRow, filter: PartQueryFilter): boolean {
  return (filter.from === undefined || session.time_created >= filter.from) && (filter.to === undefined || session.time_created <= filter.to) &&
    (filter.projectId === undefined || session.project_id === filter.projectId) && (filter.agent === undefined || (session.agent ?? "unknown") === filter.agent) &&
    (filter.sessionId === undefined || session.id === filter.sessionId);
}

export function agentUsage(db: DatabaseSync, filter: PartQueryFilter = {}, pricing: PricingConfig = EMPTY_PRICING): QueryResult<AgentSummary[]> {
  const sessions = query<SessionRow>(db, "SELECT id, agent, project_id, time_created, time_updated FROM session").filter((s) => included(s, filter));
  const sessionIds = new Set(sessions.map((s) => s.id));
  const messages = query<MessageRow>(db, "SELECT id, session_id, time_created, data FROM message").filter((m) => sessionIds.has(m.session_id));
  const parts = query<PartRow>(db, "SELECT message_id, session_id, data FROM part").filter((p) => sessionIds.has(p.session_id));
  const buckets = new Map<string, Bucket>();
  const get = (name: string): Bucket => { const value = buckets.get(name) ?? bucket(); buckets.set(name, value); return value; };
  const warnings: OcWarning[] = [];
  for (const session of sessions) {
    const name = session.agent ?? "unknown"; const b = get(name); b.sessions.add(session.id);
    if (session.time_updated >= session.time_created) { b.durations.push(session.time_updated - session.time_created); b.durationSessions.add(session.id); }
  }
  const agentByMessage = new Map<string, string>();
  for (const message of messages) {
    const decoded = decodeMessageData(message.data); warnings.push(...decoded.warnings);
    const name = decoded.value.agent ?? "unknown"; agentByMessage.set(message.id, name); const b = get(name); b.messageCount++; b.sessions.add(message.session_id);
    const session = sessions.find((item) => item.id === message.session_id);
    if (session && !b.durationSessions.has(session.id) && session.time_updated >= session.time_created) { b.durations.push(session.time_updated - session.time_created); b.durationSessions.add(session.id); }
    if (decoded.value.tokens) {
      addTokens(b.tokens, decoded.value.tokens);
      if (hasTokenUsage(decoded.value.tokens)) {
        const price = costFor(decoded.value.tokens, `${decoded.value.providerID ?? "unknown"}/${decoded.value.modelID ?? "unknown"}`, pricing);
        b.costAmount += price.amount;
        b.hasPricedUsage = b.hasPricedUsage || price.priced;
        b.allUsagePriced = b.allUsagePriced && price.priced;
      }
    }
  }
  for (const part of parts) {
    const decoded = decodePartData(part.data); warnings.push(...decoded.warnings); if (decoded.value.type !== "tool") continue;
    const b = get(agentByMessage.get(part.message_id) ?? "unknown");
    b.tools.set(decoded.value.tool, (b.tools.get(decoded.value.tool) ?? 0) + 1); if (decoded.value.status === "error") b.errorCount++;
  }
  const data = Array.from(buckets, ([agent, b]) => ({ agent, sessionCount: b.sessions.size, messageCount: b.messageCount, tokens: b.tokens,
    cost: b.hasPricedUsage && b.allUsagePriced ? { amount: b.costAmount, priced: true } : { amount: 0, priced: false }, toolMix: Array.from(b.tools, ([tool, calls]) => ({ tool, calls })).sort((a, c) => c.calls - a.calls || a.tool.localeCompare(c.tool)),
    errorCount: b.errorCount, avgSessionLengthMs: b.durations.length ? b.durations.reduce((a, n) => a + n, 0) / b.durations.length : null,
  })).sort((a, b) => b.sessionCount - a.sessionCount || a.agent.localeCompare(b.agent));
  return { data, warnings: mergeWarnings([warnings]) };
}

export function agentSwitchEvents(db: DatabaseSync): QueryResult<AgentSwitchEvent[]> {
  const warnings: OcWarning[] = [];
  const data = query<SwitchRow>(db, "SELECT seq, data FROM session_message WHERE type = 'agent-switched' ORDER BY seq").map((row) => {
    let raw: unknown; try { raw = JSON.parse(row.data); } catch { raw = null; }
    if (typeof raw !== "object" || raw === null) { warnings.push({ code: "malformed-agent-switch", message: "An agent-switched event had malformed data", count: 1 }); return { seq: row.seq, sessionId: null, agent: "unknown", timeCreated: null }; }
    const value = raw as Record<string, unknown>;
    return { seq: row.seq, sessionId: typeof value.sessionId === "string" ? value.sessionId : null, agent: typeof value.to === "string" ? value.to : "unknown", timeCreated: typeof value.time === "number" ? value.time : null };
  });
  return { data, warnings: mergeWarnings([warnings]) };
}

export function agentActivity(db: DatabaseSync): QueryResult<AgentActivityPoint[]> {
  const buckets = new Map<string, AgentActivityPoint>();
  const warnings: OcWarning[] = [];
  for (const message of query<MessageRow>(db, "SELECT id, session_id, time_created, data FROM message ORDER BY time_created, id")) {
    const decoded = decodeMessageData(message.data);
    warnings.push(...decoded.warnings);
    const dateValue = new Date(message.time_created);
    if (!Number.isFinite(message.time_created) || Number.isNaN(dateValue.getTime())) {
      warnings.push({ code: "invalid-message-time", message: "Messages had an invalid creation time", count: 1 });
      continue;
    }
    const date = dateValue.toISOString().slice(0, 10);
    const agent = decoded.value.agent ?? "unknown";
    const key = `${date}\u0000${agent}`;
    const point = buckets.get(key) ?? { date, agent, messageCount: 0 };
    point.messageCount += 1;
    buckets.set(key, point);
  }
  return {
    data: [...buckets.values()].sort((left, right) => left.date.localeCompare(right.date) || left.agent.localeCompare(right.agent)),
    warnings: mergeWarnings([warnings]),
  };
}
