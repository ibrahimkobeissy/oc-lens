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
  data: string;
}

interface RawAssistantMessageData {
  providerID?: unknown;
  modelID?: unknown;
  tokens?: {
    input?: unknown;
    output?: unknown;
    reasoning?: unknown;
    cache?: { read?: unknown; write?: unknown };
  };
}

function numberOr0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function tokensFrom(data: RawAssistantMessageData): OcTokens {
  return {
    input: numberOr0(data.tokens?.input),
    output: numberOr0(data.tokens?.output),
    reasoning: numberOr0(data.tokens?.reasoning),
    cacheRead: numberOr0(data.tokens?.cache?.read),
    cacheWrite: numberOr0(data.tokens?.cache?.write),
  };
}

/** `YYYY-MM-DD` for `epochMs` in `timeZone`, without pulling in a date library. */
function localDay(epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(epochMs),
  );
}

/**
 * A rollup bucket's running cost. `priced` is tracked explicitly rather than
 * inferred from `amount > 0` — a bucket can be genuinely priced with a $0
 * amount (priced model, zero usage) or unpriced with a nonzero-looking total
 * from other priced entries merged in, so amount alone can't tell you which.
 */
interface Bucket {
  amount: number;
  priced: boolean;
}

function addToBucket(map: Map<string, Bucket>, key: string, cost: OcCost): void {
  const existing = map.get(key) ?? { amount: 0, priced: false };
  existing.amount += cost.amount;
  existing.priced = existing.priced || cost.priced;
  map.set(key, existing);
}

function bucketsToCostArray<K extends string>(
  map: Map<string, Bucket>,
  keyField: K,
): Array<Record<K, string> & { cost: OcCost }> {
  return Array.from(map.entries()).map(([key, bucket]) => ({
    [keyField]: key,
    cost: { amount: bucket.amount, priced: bucket.priced },
  })) as Array<Record<K, string> & { cost: OcCost }>;
}

/**
 * Rolls opencode's assistant-message usage up into `CostBreakdown`, applying
 * the user's prices per `providerID/modelID` (D3). `timeZone` controls the
 * `byDay` bucketing (default UTC) — same IANA-zone convention the rest of the
 * product's time-series queries use.
 */
export function costBreakdown(db: DatabaseSync, config: PricingConfig, timeZone = "UTC"): CostBreakdown {
  const sessions = query<SessionRow>(db, "SELECT id, project_id, agent FROM session");
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const byModelTokens = new Map<string, { providerID: string; modelID: string; tokens: OcTokens }>();
  const byProject = new Map<string, Bucket>();
  const byDay = new Map<string, Bucket>();
  const bySession = new Map<string, Bucket>();
  const byAgent = new Map<string, Bucket>();
  const total: Bucket = { amount: 0, priced: false };

  const messages = query<MessageRow>(db, "SELECT session_id, time_created, data FROM message");
  for (const message of messages) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.data);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const data = parsed as RawAssistantMessageData;
    if (typeof data.providerID !== "string" || typeof data.modelID !== "string") continue;

    const key = `${data.providerID}/${data.modelID}`;
    const tokens = tokensFrom(data);
    const cost = costFor(tokens, key, config);

    total.amount += cost.amount;
    total.priced = total.priced || cost.priced;

    const modelEntry = byModelTokens.get(key) ?? {
      providerID: data.providerID,
      modelID: data.modelID,
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
    addToBucket(byAgent, session?.agent ?? "unknown", cost);
  }

  return {
    totalCost: { amount: total.amount, priced: total.priced },
    storedCostComparison: storedCostComparison(db),
    byModel: Array.from(byModelTokens.entries()).map(([key, m]) => ({
      providerID: m.providerID,
      modelID: m.modelID,
      tokens: m.tokens,
      cost: costFor(m.tokens, key, config),
    })),
    byProject: bucketsToCostArray(byProject, "projectId"),
    byDay: bucketsToCostArray(byDay, "date"),
    bySession: bucketsToCostArray(bySession, "sessionId"),
    byAgent: bucketsToCostArray(byAgent, "agent"),
  };
}
