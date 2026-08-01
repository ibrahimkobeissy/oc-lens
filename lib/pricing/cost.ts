import type { DatabaseSync } from "node:sqlite";
import { query } from "@/lib/db/connection";
import type { OcCost, OcTokens, PricingConfig } from "@/types/oc";

/**
 * `usage` × the user-entered rate for `key` (`"providerID/modelID"`).
 * `priced: false` — and `amount: 0` — whenever the user has not entered a
 * price for that key. No path through this function returns `priced: true`
 * with a zero rate (D3).
 */
export function costFor(usage: OcTokens, key: string, config: PricingConfig): OcCost {
  const rate = config.prices[key];
  if (!rate) {
    return { amount: 0, priced: false };
  }
  const amount =
    (usage.input / 1_000_000) * rate.inputPerMTok +
    (usage.output / 1_000_000) * rate.outputPerMTok +
    (usage.cacheRead / 1_000_000) * rate.cacheReadPerMTok +
    (usage.cacheWrite / 1_000_000) * rate.cacheWritePerMTok;
  return { amount, priced: true };
}

interface SessionCostRow {
  cost: number | null;
}

/**
 * Sum of opencode's own provider-reported `session.cost` — exposed
 * separately from oc-lens's own priced figures and always labelled
 * "provider-reported" wherever it's shown (D3). The maintainer's own
 * provider reports 0 here, so this is a comparison value, never the cost.
 */
export function storedCostComparison(db: DatabaseSync): number {
  const rows = query<SessionCostRow>(db, "SELECT cost FROM session");
  return rows.reduce((sum, row) => sum + (row.cost ?? 0), 0);
}
