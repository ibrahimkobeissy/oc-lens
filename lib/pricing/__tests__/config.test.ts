import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDir, makeTempDir } from "@/lib/db/__tests__/test-db";
import { isValidPricingConfig, PricingValidationError, readPricing, writePricing } from "../config";

describe("pricing config", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    cleanupTempDir(dir);
  });

  it("returns the default empty config when no file exists", () => {
    const config = readPricing({ configHome: dir });
    expect(config).toEqual({ version: 1, prices: {}, updatedAt: expect.any(Number) });
  });

  it("round-trips a written config", () => {
    const next = {
      version: 1 as const,
      prices: {
        "opencode/deepseek-v4-flash-free": {
          inputPerMTok: 3,
          outputPerMTok: 15,
          cacheReadPerMTok: 0.3,
          cacheWritePerMTok: 3.75,
          currency: "USD" as const,
        },
      },
      updatedAt: 1700000000000,
    };
    writePricing(next, { configHome: dir });
    expect(readPricing({ configHome: dir })).toEqual(next);
  });

  it("creates the config directory if it doesn't exist", () => {
    const freshDir = join(dir, "does-not-exist-yet");
    writePricing({ version: 1, prices: {}, updatedAt: 1 }, { configHome: freshDir });
    expect(existsSync(join(freshDir, "oc-lens", "config.json"))).toBe(true);
  });

  it("rejects a malformed shape and leaves any existing file untouched", () => {
    const good = { version: 1 as const, prices: {}, updatedAt: 111 };
    writePricing(good, { configHome: dir });

    expect(() => writePricing({ version: 2, prices: {} }, { configHome: dir })).toThrow(PricingValidationError);
    expect(readPricing({ configHome: dir })).toEqual(good);
  });

  it("falls back to the default config when the file on disk is corrupt JSON", () => {
    const configDir = join(dir, "oc-lens");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), "{not valid json", "utf-8");
    expect(readPricing({ configHome: dir })).toEqual({ version: 1, prices: {}, updatedAt: expect.any(Number) });
  });

  it("write is atomic: a failure during the write step leaves the previous file intact", () => {
    const good = { version: 1 as const, prices: {}, updatedAt: 222 };
    writePricing(good, { configHome: dir });

    // Make the config directory read-only so the temp-file write inside writePricing throws
    // before any rename can happen — the previous good file must survive untouched.
    const configDir = join(dir, "oc-lens");
    chmodSync(configDir, 0o555);
    try {
      expect(() => writePricing({ version: 1, prices: {}, updatedAt: 333 }, { configHome: dir })).toThrow();
    } finally {
      chmodSync(configDir, 0o755);
    }

    const onDisk: unknown = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
    expect(onDisk).toEqual(good);
  });

  it("isValidPricingConfig rejects a config with a negative rate", () => {
    expect(
      isValidPricingConfig({
        version: 1,
        prices: {
          "a/b": { inputPerMTok: -1, outputPerMTok: 1, cacheReadPerMTok: 1, cacheWritePerMTok: 1, currency: "USD" },
        },
        updatedAt: 1,
      }),
    ).toBe(false);
  });
});
