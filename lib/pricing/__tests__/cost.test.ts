import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";
import type { PricingConfig } from "@/types/oc";
import { costFor, storedCostComparison } from "../cost";

describe("costFor", () => {
  const config: PricingConfig = {
    version: 1,
    prices: {
      "opencode/deepseek-v4-flash-free": {
        inputPerMTok: 3,
        outputPerMTok: 15,
        cacheReadPerMTok: 0.3,
        cacheWritePerMTok: 3.75,
        currency: "USD",
      },
    },
    updatedAt: 1,
  };

  it("computes an exact hand-checked amount across all four token classes", () => {
    const usage = { input: 1_000_000, output: 500_000, reasoning: 0, cacheRead: 2_000_000, cacheWrite: 100_000 };
    // (1 * 3) + (0.5 * 15) + (2 * 0.3) + (0.1 * 3.75) = 3 + 7.5 + 0.6 + 0.375 = 11.475
    const cost = costFor(usage, "opencode/deepseek-v4-flash-free", config);
    expect(cost.priced).toBe(true);
    expect(cost.amount).toBeCloseTo(11.475, 6);
  });

  it("returns priced:false and amount:0 for a key with no configured price — never priced:true with a zero rate", () => {
    const usage = { input: 1_000_000, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
    const cost = costFor(usage, "some/unpriced-model", config);
    expect(cost).toEqual({ amount: 0, priced: false });
  });

  it("returns amount:0 priced:true for a priced model with zero usage — distinct from unpriced", () => {
    const usage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
    const cost = costFor(usage, "opencode/deepseek-v4-flash-free", config);
    expect(cost).toEqual({ amount: 0, priced: true });
  });
});

describe("storedCostComparison", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = makeTempDir();
    dbPath = join(dir, "test.db");
    createFullSchemaDb(dbPath);
  });

  afterEach(() => {
    cleanupTempDir(dir);
  });

  it("sums session.cost across all sessions", () => {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      INSERT INTO session (id, project_id, cost, agent, time_created, time_updated)
      VALUES ('ses_2', 'global', 2.5, 'build', 2, 2);
    `);
    // The fixture's seed session (ses_1) has cost = 0.
    expect(storedCostComparison(db)).toBeCloseTo(2.5, 6);
    db.close();
  });
});
