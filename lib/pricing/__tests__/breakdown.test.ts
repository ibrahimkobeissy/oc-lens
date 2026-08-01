import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";
import type { PricingConfig } from "@/types/oc";
import { costBreakdown } from "../breakdown";

describe("costBreakdown", () => {
  let dir: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dir = makeTempDir();
    const dbPath = join(dir, "test.db");
    createFullSchemaDb(dbPath);
    db = new DatabaseSync(dbPath);
    db.exec(`
      INSERT INTO project (id, worktree, time_created, time_updated) VALUES ('proj_a', '/a', 1, 1);
      INSERT INTO session (id, project_id, agent, cost, time_created, time_updated) VALUES ('ses_2', 'proj_a', 'plan', 0, 1704067200000, 1704067200000);
      INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES
        ('msg_p1', 'ses_1', 1704067200000, 1704067200000, '${JSON.stringify({
          role: "assistant",
          providerID: "opencode",
          modelID: "priced-model",
          tokens: { input: 1_000_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })}'),
        ('msg_p2', 'ses_2', 1704067200000, 1704067200000, '${JSON.stringify({
          role: "assistant",
          providerID: "opencode",
          modelID: "unpriced-model",
          tokens: { input: 1_000_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })}');
    `);
  });

  afterEach(() => {
    db.close();
    cleanupTempDir(dir);
  });

  it("rolls up cost by model/project/day/session/agent, honoring priced vs unpriced", () => {
    const config: PricingConfig = {
      version: 1,
      prices: {
        "opencode/priced-model": {
          inputPerMTok: 5,
          outputPerMTok: 5,
          cacheReadPerMTok: 5,
          cacheWritePerMTok: 5,
          currency: "USD",
        },
      },
      updatedAt: 1,
    };

    const result = costBreakdown(db, config, "UTC");

    expect(result.totalCost).toEqual({ amount: 5, priced: true });

    const priced = result.byModel.find((m) => m.modelID === "priced-model");
    const unpriced = result.byModel.find((m) => m.modelID === "unpriced-model");
    expect(priced?.cost).toEqual({ amount: 5, priced: true });
    expect(unpriced?.cost).toEqual({ amount: 0, priced: false });

    const projGlobal = result.byProject.find((p) => p.projectId === "global");
    const projA = result.byProject.find((p) => p.projectId === "proj_a");
    expect(projGlobal?.cost).toEqual({ amount: 5, priced: true });
    expect(projA?.cost).toEqual({ amount: 0, priced: false });

    const agentBuild = result.byAgent.find((a) => a.agent === "build");
    const agentPlan = result.byAgent.find((a) => a.agent === "plan");
    expect(agentBuild?.cost.amount).toBeCloseTo(5, 6);
    expect(agentPlan?.cost).toEqual({ amount: 0, priced: false });

    expect(result.byDay).toHaveLength(1);
    expect(result.byDay[0]?.date).toBe("2024-01-01");

    expect(result.bySession.find((s) => s.sessionId === "ses_1")?.cost.amount).toBeCloseTo(5, 6);
  });
});
