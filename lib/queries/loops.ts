import type { DatabaseSync } from "node:sqlite";
import { query } from "@/lib/db/connection";
import { decodePartData, decodeMessageData, mergeWarnings } from "@/lib/decode";
import { costForMessageData } from "@/lib/pricing/breakdown";
import { callSignature, contentSignature, isFailedCall, targetPath, toolExitCode } from "@/lib/loops";
import type {
  LoopAnalysis,
  LoopIncident,
  LoopKind,
  OcCost,
  OcPartToolData,
  OcTokens,
  OcWarning,
  PricingConfig,
} from "@/types/oc";
import type { PartQueryFilter, QueryResult } from "./tools";

/**
 * Loop detection (post-v1) — finding the turns that produced nothing.
 *
 * Three shapes are reported, and the boundaries between them matter more than
 * the detection itself:
 *
 * - `error-retry`      the same call failing over and over
 * - `redundant-repeat` the same call succeeding over and over, telling us nothing new
 * - `oscillation`      one path rewritten between contents it already had
 *
 * `oscillation` is deliberately detected *before* repeats and claims its calls,
 * because A→B→A→B is one incident built from two signatures — counting "any
 * signature seen twice" reports it as two redundant repeats, which is wrong.
 * The fixture's `oscillation` scenario exists to hold that line.
 *
 * Everything here is evidence-bounded: a call whose input opencode never
 * recorded is excluded and counted in `coverage`, never guessed at.
 */

/**
 * A signature must appear at least this often before it is an incident.
 *
 * Three, not two: a pair of identical calls is usually ordinary work (re-reading
 * a file after a compaction, checking something twice). What users mean by "a
 * loop" is an action that keeps happening — a build retried until it passes.
 * The threshold stays adjustable, so a pair-level view is one control away.
 */
const DEFAULT_MIN_REPEATS = 3;

const EMPTY_PRICING: PricingConfig = { version: 1, prices: {}, updatedAt: 0 };

export interface LoopQueryOptions {
  /** Lowest repeat count that counts as a loop. Defaults to 2. */
  minRepeats?: number;
}

interface PartRow {
  id: string;
  session_id: string;
  message_id: string;
  time_created: number;
  data: string;
}

interface Call {
  partId: string;
  sessionId: string;
  messageId: string;
  timeCreated: number;
  tool: string;
  status: OcPartToolData["status"];
  signature: string | null;
  content: string | null;
  path: string | null;
  /** True when the tool errored *or* the command it ran exited non-zero. */
  failed: boolean;
}

const zeroTokens = (): OcTokens => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });

function addTokens(target: OcTokens, add: OcTokens, scale: number): void {
  target.input += add.input * scale;
  target.output += add.output * scale;
  target.reasoning += add.reasoning * scale;
  target.cacheRead += add.cacheRead * scale;
  target.cacheWrite += add.cacheWrite * scale;
}

function toolPartRows(db: DatabaseSync, filter: PartQueryFilter): PartRow[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filter.from !== undefined) { clauses.push("p.time_created >= ?"); params.push(filter.from); }
  if (filter.to !== undefined) { clauses.push("p.time_created < ?"); params.push(filter.to); }
  if (filter.projectId !== undefined) { clauses.push("s.project_id = ?"); params.push(filter.projectId); }
  if (filter.agent !== undefined) { clauses.push("COALESCE(s.agent, 'unknown') = ?"); params.push(filter.agent); }
  if (filter.sessionId !== undefined) { clauses.push("p.session_id = ?"); params.push(filter.sessionId); }
  return query<PartRow>(
    db,
    `SELECT p.id, p.session_id, p.message_id, p.time_created, p.data
     FROM part p JOIN session s ON s.id = p.session_id
     ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY p.session_id, p.time_created, p.id`,
    params,
  );
}

/**
 * Per-call cost and tokens. opencode records cost per *message*, not per tool
 * call, so a message's usage is split evenly across the tool calls it contains.
 * That split is an attribution choice, not measured data — hence the note on
 * `LoopIncident.repeatedTurnCost`.
 */
interface CallCost {
  cost: OcCost;
  tokens: OcTokens;
}

function perCallCosts(
  db: DatabaseSync,
  calls: Call[],
  pricing: PricingConfig,
): { costs: Map<string, CallCost>; warnings: OcWarning[] } {
  const warnings: OcWarning[] = [];
  const callsPerMessage = new Map<string, number>();
  for (const call of calls) callsPerMessage.set(call.messageId, (callsPerMessage.get(call.messageId) ?? 0) + 1);

  const messageIds = new Set(calls.map((c) => c.messageId));
  const costs = new Map<string, CallCost>();
  if (messageIds.size === 0) return { costs, warnings };

  const byMessage = new Map<string, CallCost>();
  for (const row of query<{ id: string; data: string }>(db, "SELECT id, data FROM message")) {
    if (!messageIds.has(row.id)) continue;
    const share = callsPerMessage.get(row.id) ?? 1;
    const decoded = decodeMessageData(row.data);
    warnings.push(...decoded.warnings);
    const cost = costForMessageData(row.data, pricing);
    const tokens = decoded.value.tokens ?? zeroTokens();
    byMessage.set(row.id, {
      cost: { amount: cost.priced ? cost.amount / share : 0, priced: cost.priced },
      tokens: {
        input: tokens.input / share,
        output: tokens.output / share,
        reasoning: tokens.reasoning / share,
        cacheRead: tokens.cacheRead / share,
        cacheWrite: tokens.cacheWrite / share,
      },
    });
  }

  // Re-key by part: incidents are groups of tool calls, and a message can hold
  // several of them, so every lookup downstream is by part id.
  for (const call of calls) {
    const entry = byMessage.get(call.messageId);
    if (entry) costs.set(call.partId, entry);
  }
  return { costs, warnings };
}

/** Sums the wasted calls' usage. Unpriced unless every contributing message was priced. */
function wastedUsage(wastedPartIds: string[], byPart: Map<string, CallCost>): { cost: OcCost; tokens: OcTokens } {
  const tokens = zeroTokens();
  let amount = 0;
  let allPriced = true;
  let any = false;
  for (const partId of wastedPartIds) {
    const entry = byPart.get(partId);
    if (!entry) { allPriced = false; continue; }
    any = true;
    amount += entry.cost.amount;
    allPriced = allPriced && entry.cost.priced;
    addTokens(tokens, entry.tokens, 1);
  }
  return { cost: any && allPriced ? { amount, priced: true } : { amount: 0, priced: false }, tokens };
}

function incidentFrom(
  kind: LoopKind,
  signature: string,
  group: Call[],
  costByPart: Map<string, CallCost>,
  sessionCalls: Call[] = [],
): LoopIncident {
  const ordered = [...group].sort((a, b) => a.timeCreated - b.timeCreated || a.partId.localeCompare(b.partId));
  const partIds = ordered.map((c) => c.partId);
  // The first call is ordinary work; only what follows it produced nothing new.
  const { cost, tokens } = wastedUsage(partIds.slice(1), costByPart);
  const first = ordered[0]?.timeCreated ?? 0;
  const last = ordered[ordered.length - 1]?.timeCreated ?? 0;
  const own = new Set(partIds);
  const interveningCalls = sessionCalls.filter(
    (call) => !own.has(call.partId) && call.timeCreated >= first && call.timeCreated <= last,
  ).length;
  return {
    kind,
    sessionId: ordered[0]?.sessionId ?? "",
    tool: ordered[0]?.tool ?? "",
    signature,
    calls: ordered.length,
    wastedCalls: ordered.length - 1,
    partIds,
    interveningCalls,
    firstAt: ordered[0]?.timeCreated ?? 0,
    lastAt: ordered[ordered.length - 1]?.timeCreated ?? 0,
    repeatedTurnCost: cost,
    repeatedTurnTokens: tokens,
  };
}

/**
 * One path written between contents it already held. Requires at least two
 * distinct contents (otherwise it is a plain repeat, not an undo) and at least
 * one content written more than once (otherwise it is ordinary iteration —
 * exactly the fixture's `control` scenario, which must never be flagged).
 */
function oscillations(calls: Call[], minRepeats: number, costByPart: Map<string, CallCost>): {
  incidents: LoopIncident[];
  claimed: Set<string>;
} {
  const byPath = new Map<string, Call[]>();
  for (const call of calls) {
    if (call.path === null || call.content === null) continue;
    const key = `${call.tool} ${call.path}`;
    const bucket = byPath.get(key) ?? [];
    bucket.push(call);
    byPath.set(key, bucket);
  }

  const incidents: LoopIncident[] = [];
  const claimed = new Set<string>();
  for (const [key, group] of byPath) {
    if (group.length < minRepeats) continue;
    const counts = new Map<string, number>();
    for (const call of group) counts.set(call.content ?? "", (counts.get(call.content ?? "") ?? 0) + 1);
    const revisited = [...counts.values()].some((count) => count > 1);
    if (counts.size < 2 || !revisited) continue;

    const path = key.split(" ")[1] ?? "";
    // Identified by the path being flip-flopped, since the incident spans more
    // than one input signature by definition.
    const signature = `${group[0]?.tool ?? ""}:${callSignature("path", { path })?.split(":")[1] ?? ""}`;
    incidents.push(incidentFrom("oscillation", signature, group, costByPart, calls));
    for (const call of group) claimed.add(call.partId);
  }
  return { incidents, claimed };
}

/**
 * Splits a repeat group wherever the file it targets was modified in between.
 *
 * Reading a file, editing it, then reading it again is correct behaviour — the
 * second read returns different bytes, so it is not redundant. Without this the
 * detector reports ordinary edit-then-verify work as a loop, which is the
 * fastest way to make the whole page untrustworthy.
 *
 * Only *completed* mutations by calls outside the group count: a failed edit
 * changed nothing, and a group of repeated writes must not split itself.
 */
function splitOnMutations(ordered: Call[], sessionCalls: Call[]): Call[][] {
  const path = ordered[0]?.path ?? null;
  if (path === null) return [ordered];

  const own = new Set(ordered.map((call) => call.partId));
  const mutations = sessionCalls
    .filter(
      (call) =>
        call.path === path &&
        call.content !== null &&
        !call.failed &&
        !own.has(call.partId),
    )
    .map((call) => call.timeCreated)
    .sort((a, b) => a - b);
  if (mutations.length === 0) return [ordered];

  const groups: Call[][] = [];
  let current: Call[] = [];
  for (const call of ordered) {
    const previous = current[current.length - 1];
    const changedSincePrevious =
      previous !== undefined &&
      mutations.some((at) => at > previous.timeCreated && at <= call.timeCreated);
    if (changedSincePrevious) {
      groups.push(current);
      current = [];
    }
    current.push(call);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export function detectLoops(
  db: DatabaseSync,
  filter: PartQueryFilter = {},
  pricing: PricingConfig = EMPTY_PRICING,
  options: LoopQueryOptions = {},
): QueryResult<LoopAnalysis> {
  const minRepeats = Math.max(2, options.minRepeats ?? DEFAULT_MIN_REPEATS);
  const warnings: OcWarning[] = [];

  const calls: Call[] = [];
  let toolCalls = 0;
  const toolsSeen = new Set<string>();
  const toolsSignaturable = new Set<string>();

  for (const row of toolPartRows(db, filter)) {
    const decoded = decodePartData(row.data);
    warnings.push(...decoded.warnings);
    if (decoded.value.type !== "tool") continue;
    toolCalls++;
    toolsSeen.add(decoded.value.tool);
    const signature = callSignature(decoded.value.tool, decoded.value.input);
    if (signature !== null) toolsSignaturable.add(decoded.value.tool);
    calls.push({
      partId: row.id,
      sessionId: row.session_id,
      messageId: row.message_id,
      timeCreated: row.time_created,
      tool: decoded.value.tool,
      status: decoded.value.status,
      signature,
      content: contentSignature(decoded.value.input),
      path: targetPath(decoded.value.input),
      failed: isFailedCall(decoded.value.status, toolExitCode(row.data)),
    });
  }

  const signaturable = calls.filter((c) => c.signature !== null);
  const { costs, warnings: costWarnings } = perCallCosts(db, signaturable, pricing);
  warnings.push(...costWarnings);

  const bySession = new Map<string, Call[]>();
  for (const call of signaturable) {
    const bucket = bySession.get(call.sessionId) ?? [];
    bucket.push(call);
    bySession.set(call.sessionId, bucket);
  }

  const incidents: LoopIncident[] = [];
  for (const sessionCalls of bySession.values()) {
    const osc = oscillations(sessionCalls, minRepeats, costs);
    incidents.push(...osc.incidents);

    const bySignature = new Map<string, Call[]>();
    for (const call of sessionCalls) {
      if (osc.claimed.has(call.partId)) continue;
      const key = call.signature as string;
      const bucket = bySignature.get(key) ?? [];
      bucket.push(call);
      bySignature.set(key, bucket);
    }
    for (const [signature, group] of bySignature) {
      if (group.length < minRepeats) continue;
      const ordered = [...group].sort(
        (a, b) => a.timeCreated - b.timeCreated || a.partId.localeCompare(b.partId),
      );
      // A repeat stops being a repeat once the file underneath it changed.
      for (const run of splitOnMutations(ordered, sessionCalls)) {
        if (run.length < minRepeats) continue;
        // Outcome, not tool status: opencode marks a shell command that exited
        // non-zero as `completed`, so a build retried until it passes would
        // otherwise be filed as a harmless repeat.
        const kind: LoopKind = run.every((c) => c.failed) ? "error-retry" : "redundant-repeat";
        incidents.push(incidentFrom(kind, signature, run, costs, sessionCalls));
      }
    }
  }

  // Ranking order matters more than any single number here. Failures first,
  // then how many times it repeated, then how tightly clustered those repeats
  // were — a run with little else in between is the thing worth looking at.
  const KIND_RANK: Record<LoopKind, number> = { "error-retry": 0, oscillation: 1, "redundant-repeat": 2 };
  incidents.sort(
    (a, b) =>
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      b.calls - a.calls ||
      a.interveningCalls - b.interveningCalls ||
      a.sessionId.localeCompare(b.sessionId) ||
      a.signature.localeCompare(b.signature),
  );

  let totalAmount = 0;
  let totalWastedCalls = 0;
  let allPriced = incidents.length > 0;
  for (const incident of incidents) {
    totalAmount += incident.repeatedTurnCost.amount;
    totalWastedCalls += incident.wastedCalls;
    allPriced = allPriced && incident.repeatedTurnCost.priced;
  }

  return {
    data: {
      incidents,
      coverage: {
        toolCalls,
        signaturable: signaturable.length,
        unsignaturable: toolCalls - signaturable.length,
        unsignaturableTools: [...toolsSeen].filter((tool) => !toolsSignaturable.has(tool)).sort(),
      },
      totalRepeatedTurnCost: allPriced ? { amount: totalAmount, priced: true } : { amount: 0, priced: false },
      totalWastedCalls,
    },
    warnings: mergeWarnings([warnings]),
  };
}
