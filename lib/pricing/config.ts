import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PricingConfig, PricingModelRate } from "@/types/oc";

/**
 * Test-only path overrides — never accept these from an HTTP request. The
 * production path is always `~/.config/oc-lens/config.json` (honouring
 * `XDG_CONFIG_HOME`); no function in this module accepts an arbitrary path,
 * only these two narrow overrides for isolating tests from the real file.
 */
export interface PricingPathOptions {
  configHome?: string;
  homeDir?: string;
}

function resolveConfigPath(options: PricingPathOptions = {}): string {
  const xdg = options.configHome ?? process.env.XDG_CONFIG_HOME;
  const home = options.homeDir ?? homedir();
  const base = xdg && xdg.length > 0 ? xdg : join(home, ".config");
  return join(base, "oc-lens", "config.json");
}

export class PricingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingValidationError";
  }
}

function isValidRate(value: unknown): value is PricingModelRate {
  if (typeof value !== "object" || value === null) return false;
  const rate = value as Record<string, unknown>;
  return (
    typeof rate.inputPerMTok === "number" &&
    typeof rate.outputPerMTok === "number" &&
    typeof rate.cacheReadPerMTok === "number" &&
    typeof rate.cacheWritePerMTok === "number" &&
    rate.currency === "USD" &&
    [rate.inputPerMTok, rate.outputPerMTok, rate.cacheReadPerMTok, rate.cacheWritePerMTok].every(
      (n) => Number.isFinite(n) && n >= 0,
    )
  );
}

/** Documented decoder boundary: validates an arbitrary JSON value against `PricingConfig`'s shape before it is ever trusted or written to disk. */
export function isValidPricingConfig(value: unknown): value is PricingConfig {
  if (typeof value !== "object" || value === null) return false;
  const config = value as Record<string, unknown>;
  if (config.version !== 1) return false;
  if (typeof config.updatedAt !== "number") return false;
  if (typeof config.prices !== "object" || config.prices === null) return false;
  return Object.values(config.prices as Record<string, unknown>).every(isValidRate);
}

function defaultConfig(): PricingConfig {
  return { version: 1, prices: {}, updatedAt: Date.now() };
}

/**
 * Reads the pricing config file. A missing file returns the default empty
 * config (no prices entered yet) rather than throwing. A present-but-corrupt
 * file (bad JSON, or JSON that fails `isValidPricingConfig`) also falls back
 * to the default empty config — this is oc-lens's own state, not opencode
 * data, so a forgiving read is preferable to crashing every route that needs
 * pricing just because the user's price file got hand-edited badly.
 */
export function readPricing(options: PricingPathOptions = {}): PricingConfig {
  const path = resolveConfigPath(options);
  if (!existsSync(path)) {
    return defaultConfig();
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!isValidPricingConfig(raw)) {
      return defaultConfig();
    }
    return raw;
  } catch {
    return defaultConfig();
  }
}

/**
 * Writes the pricing config atomically (temp file + rename) after validating
 * its shape. Throws `PricingValidationError` — and leaves the existing file
 * untouched — when `next` doesn't match `PricingConfig`'s shape.
 */
export function writePricing(next: unknown, options: PricingPathOptions = {}): PricingConfig {
  if (!isValidPricingConfig(next)) {
    throw new PricingValidationError("Pricing config does not match the expected shape");
  }
  const path = resolveConfigPath(options);
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(next, null, 2), "utf-8");
  renameSync(tmpPath, path);
  return next;
}

/** Test-only: removes the config file (and any stray temp file) so a test starts from a clean slate. */
export function resetPricingForTests(options: PricingPathOptions = {}): void {
  const path = resolveConfigPath(options);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}
