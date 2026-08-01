import type { OcCost } from "@/types/oc";

const numberFormatter = new Intl.NumberFormat("en-US");
const compactNumberFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const usdFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Formats an integer count with locale thousands separators, e.g. 12345 -> "12,345". */
export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/**
 * Formats a token count compactly for space-constrained UI (stat cards,
 * chart axes), e.g. 1234567 -> "1.2M". Falls back to a plain integer below 1000.
 */
export function formatTokens(value: number): string {
  if (Math.abs(value) < 1000) return numberFormatter.format(value);
  return compactNumberFormatter.format(value);
}

/**
 * Formats a duration in milliseconds as a human string ("450ms", "3.2s", "2m 5s", "1h 4m").
 * `null` (e.g. an incomplete tool call or turn) renders as "—", never "0ms" or "NaNms".
 */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = Math.round(totalSeconds % 60);
  if (totalMinutes < 60) return `${totalMinutes}m ${remainingSeconds}s`;
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Formats an `OcCost` (D3: cost is always user-priced, never a bundled table).
 * `priced: false` renders as the literal string "not priced" — NEVER "$0.00" —
 * regardless of what `amount` happens to hold. This is the single most
 * load-bearing invariant in the pricing UI; every cost display in the product
 * must go through this function rather than formatting `amount` directly.
 */
export function formatCost(cost: OcCost): string {
  if (!cost.priced) return "not priced";
  return usdFormatter.format(cost.amount);
}
