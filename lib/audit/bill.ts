import type { DailyUsageRow } from "@/lib/pricing/breakdown";

/**
 * Compares a provider's daily usage export with what opencode recorded. Runs in
 * the browser only: the bill is never uploaded, stored, or sent anywhere.
 *
 * Provider exports differ, so columns are matched by common header names and
 * every column the bill lacks is simply not compared. Rows for the same day
 * (one per model, say) are summed.
 */

export const BILL_METRICS = ["input", "output", "cacheRead", "cacheWrite", "cost"] as const;
export type BillMetric = (typeof BILL_METRICS)[number];
export type TokenMetric = Exclude<BillMetric, "cost">;
export const TOKEN_METRICS: readonly TokenMetric[] = ["input", "output", "cacheRead", "cacheWrite"];

const HEADER_ALIASES: Record<BillMetric | "date", readonly string[]> = {
  date: ["date", "day", "usage_date", "start_time", "starting_at", "timestamp", "time", "period_start", "bucket_start"],
  input: ["input_tokens", "input", "prompt_tokens", "uncached_input_tokens", "input_uncached_tokens", "n_context_tokens_total"],
  output: ["output_tokens", "output", "completion_tokens", "n_generated_tokens_total"],
  cacheRead: ["cache_read_tokens", "cache_read", "cached_tokens", "cache_read_input_tokens", "input_cached_tokens", "cached_input_tokens"],
  cacheWrite: ["cache_write_tokens", "cache_write", "cache_creation_tokens", "cache_creation_input_tokens"],
  cost: ["cost_usd", "cost", "amount_usd", "amount", "total_cost", "cost_in_usd"],
};

export const BILL_TEMPLATE = "date,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,cost_usd\n2026-10-01,1200000,45000,800000,0,4.20\n";

export interface BillDay {
  date: string;
  values: Partial<Record<BillMetric, number>>;
}

export type ParsedBill =
  | { ok: true; days: BillDay[]; metrics: BillMetric[]; skippedRows: number }
  | { ok: false; error: string };

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Minimal RFC 4180 line splitter: quoted fields, doubled quotes, commas or semicolons. */
function splitCsvLine(line: string, separator: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) { fields.push(field); field = ""; }
    else field += char;
  }
  fields.push(field);
  return fields;
}

function parseDate(value: string): string | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function parseNumber(value: string): number | null {
  let cleaned = value.trim().replace(/[$€£\s]/g, "").replace(/,(?=\d{3}(\D|$))/g, "");
  // A remaining comma with no dot is a decimal comma ("4,20").
  if (!cleaned.includes(".")) cleaned = cleaned.replace(",", ".");
  if (cleaned === "") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseBillCsv(text: string): ParsedBill {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  const header = lines[0];
  if (header === undefined) return { ok: false, error: "The file is empty." };
  const separator = header.split(";").length > header.split(",").length ? ";" : ",";
  const headers = splitCsvLine(header, separator).map(normalizeHeader);
  const column = (names: readonly string[]) => {
    for (const name of names) { const index = headers.indexOf(name); if (index >= 0) return index; }
    return -1;
  };
  const dateColumn = column(HEADER_ALIASES.date);
  if (dateColumn < 0) return { ok: false, error: `No date column found. Expected one of: ${HEADER_ALIASES.date.join(", ")}.` };
  const metricColumns = BILL_METRICS.map((metric) => [metric, column(HEADER_ALIASES[metric])] as const).filter(([, index]) => index >= 0);
  if (metricColumns.length === 0) return { ok: false, error: "No token or cost column found. Use the template headers, e.g. input_tokens, output_tokens, cost_usd." };

  const byDate = new Map<string, BillDay>();
  let skippedRows = 0;
  for (const line of lines.slice(1)) {
    const fields = splitCsvLine(line, separator);
    const date = parseDate(fields[dateColumn] ?? "");
    if (!date) { skippedRows += 1; continue; }
    const day = byDate.get(date) ?? { date, values: {} };
    for (const [metric, index] of metricColumns) {
      const value = parseNumber(fields[index] ?? "");
      if (value !== null) day.values[metric] = (day.values[metric] ?? 0) + value;
    }
    byDate.set(date, day);
  }
  if (byDate.size === 0) return { ok: false, error: "No row had a YYYY-MM-DD date." };
  return { ok: true, days: [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)), metrics: metricColumns.map(([metric]) => metric), skippedRows };
}

export interface ReconciledDay {
  date: string;
  billedTokens: number | null; // sum of the token columns the bill has
  recordedTokens: number; // the same columns, from opencode
  tokenGap: number | null; // billed - recorded; positive = billed for more than opencode saw
  billedCost: number | null;
  recordedCost: number | null; // null unless every message that day was priced
  flagged: boolean;
}

export interface Reconciliation {
  days: ReconciledDay[];
  comparedMetrics: TokenMetric[];
  flaggedDays: number;
  totalTokenGap: number;
  billOnlyDays: number; // days on the bill with no opencode usage at all
}

/**
 * A day is flagged when the bill exceeds what opencode recorded by more than
 * `tolerance` (a fraction) and by at least `minTokens`, so rounding and tiny
 * counting differences between tokenizers do not raise alarms.
 */
export function reconcile(bill: Extract<ParsedBill, { ok: true }>, recorded: readonly DailyUsageRow[], tolerance = 0.05, minTokens = 1_000): Reconciliation {
  const recordedByDate = new Map(recorded.map((row) => [row.date, row]));
  const comparedMetrics = TOKEN_METRICS.filter((metric) => bill.metrics.includes(metric));
  const days = bill.days.map((day): ReconciledDay => {
    const row = recordedByDate.get(day.date);
    const recordedTokens = row ? comparedMetrics.reduce((sum, metric) => sum + row.tokens[metric], 0) : 0;
    const billedTokens = comparedMetrics.length === 0 ? null : comparedMetrics.reduce((sum, metric) => sum + (day.values[metric] ?? 0), 0);
    const tokenGap = billedTokens === null ? null : billedTokens - recordedTokens;
    const billedCost = day.values.cost ?? null;
    const recordedCost = row && row.unpricedMessages === 0 ? row.pricedAmount : null;
    const tokenFlag = tokenGap !== null && tokenGap >= minTokens && tokenGap > recordedTokens * tolerance;
    const costFlag = billedCost !== null && recordedCost !== null && billedCost - recordedCost > Math.max(0.01, recordedCost * tolerance);
    return { date: day.date, billedTokens, recordedTokens, tokenGap, billedCost, recordedCost, flagged: tokenFlag || costFlag };
  });
  return {
    days,
    comparedMetrics,
    flaggedDays: days.filter((day) => day.flagged).length,
    totalTokenGap: days.reduce((sum, day) => sum + Math.max(0, day.tokenGap ?? 0), 0),
    billOnlyDays: bill.days.filter((day) => !recordedByDate.has(day.date)).length,
  };
}
