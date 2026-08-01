import type { DatabaseSync } from "node:sqlite";
import { query } from "@/lib/db/connection";
import type { OcTokens, PricingConfig } from "@/types/oc";

export interface PricableModel {
  providerID: string;
  modelID: string;
  /** `"<providerID>/<modelID>"` — the same key `PricingConfig.prices` and `costFor` use. */
  key: string;
  tokens: OcTokens;
  priced: boolean;
}

interface MessageDataRow {
  data: string;
}

/**
 * The subset of `message.data` this module reads — `providerID`/`modelID`/
 * `tokens` live on assistant messages only (data-model.md §4). This is a
 * narrow, local decode boundary distinct from OCL-012's full `OcMessageData`
 * decoder, which doesn't exist yet; this ticket does not depend on it.
 */
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

function zeroTokens(): OcTokens {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

/**
 * Every distinct `providerID/modelID` seen in `message.data`, with observed
 * token volume — so a pricing UI can show the user exactly which models are
 * worth pricing. Malformed `data` JSON is skipped (not this module's job to
 * warn about decode failures; that belongs to OCL-012).
 */
export function listPricableModels(db: DatabaseSync, config: PricingConfig): PricableModel[] {
  const rows = query<MessageDataRow>(db, "SELECT data FROM message");
  const byKey = new Map<string, { providerID: string; modelID: string; tokens: OcTokens }>();

  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const data = parsed as RawAssistantMessageData;
    if (typeof data.providerID !== "string" || typeof data.modelID !== "string") continue;

    const key = `${data.providerID}/${data.modelID}`;
    const existing = byKey.get(key) ?? {
      providerID: data.providerID,
      modelID: data.modelID,
      tokens: zeroTokens(),
    };
    existing.tokens.input += numberOr0(data.tokens?.input);
    existing.tokens.output += numberOr0(data.tokens?.output);
    existing.tokens.reasoning += numberOr0(data.tokens?.reasoning);
    existing.tokens.cacheRead += numberOr0(data.tokens?.cache?.read);
    existing.tokens.cacheWrite += numberOr0(data.tokens?.cache?.write);
    byKey.set(key, existing);
  }

  return Array.from(byKey.values()).map((model) => {
    const key = `${model.providerID}/${model.modelID}`;
    return { ...model, key, priced: key in config.prices };
  });
}
