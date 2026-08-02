import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";
import { withFixture } from "@/test/fixtures";
import { PROVIDER_MODELS } from "@/test/fixtures/manifest";
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
          agent: "build",
          providerID: "opencode",
          modelID: "priced-model",
          tokens: { input: 1_000_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })}'),
        ('msg_p2', 'ses_2', 1704067200000, 1704067200000, '${JSON.stringify({
          role: "assistant",
          agent: "message-plan",
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

    expect(result.totalCost).toEqual({ amount: 0, priced: false });

    const priced = result.byModel.find((m) => m.modelID === "priced-model");
    const unpriced = result.byModel.find((m) => m.modelID === "unpriced-model");
    expect(priced?.cost).toEqual({ amount: 5, priced: true });
    expect(unpriced?.cost).toEqual({ amount: 0, priced: false });

    const projGlobal = result.byProject.find((p) => p.projectId === "global");
    const projA = result.byProject.find((p) => p.projectId === "proj_a");
    expect(projGlobal?.cost).toEqual({ amount: 5, priced: true });
    expect(projA?.cost).toEqual({ amount: 0, priced: false });

    const agentBuild = result.byAgent.find((a) => a.agent === "build");
    const agentPlan = result.byAgent.find((a) => a.agent === "message-plan");
    expect(agentBuild?.cost.amount).toBeCloseTo(5, 6);
    expect(agentPlan?.cost).toEqual({ amount: 0, priced: false });

    expect(result.byDay).toHaveLength(1);
    expect(result.byDay[0]?.date).toBe("2024-01-01");
    expect(result.byDay[0]?.cost).toEqual({ amount: 0, priced: false });

    expect(result.bySession.find((s) => s.sessionId === "ses_1")?.cost.amount).toBeCloseTo(5, 6);
  });

  it("scopes the underlying session/message scan to sessionIds instead of the whole database (code-review-2026-08-02.md M2)", () => {
    const config: PricingConfig = {
      version: 1,
      prices: {
        "opencode/priced-model": { inputPerMTok: 5, outputPerMTok: 5, cacheReadPerMTok: 5, cacheWritePerMTok: 5, currency: "USD" },
        "opencode/unpriced-model": { inputPerMTok: 5, outputPerMTok: 5, cacheReadPerMTok: 5, cacheWritePerMTok: 5, currency: "USD" },
      },
      updatedAt: 1,
    };

    const scoped = costBreakdown(db, config, "UTC", {}, ["ses_1"]);
    expect(scoped.bySession.map((s) => s.sessionId)).toEqual(["ses_1"]);
    expect(scoped.bySession.find((s) => s.sessionId === "ses_2")).toBeUndefined();
    expect(scoped.byModel.find((m) => m.modelID === "unpriced-model")).toBeUndefined();
    expect(scoped.totalCost.amount).toBeCloseTo(5, 6);

    const unscoped = costBreakdown(db, config, "UTC", {}, undefined);
    expect(unscoped.bySession.map((s) => s.sessionId).sort()).toEqual(["ses_1", "ses_2"]);
    expect(unscoped.totalCost.amount).toBeCloseTo(10, 6);
  });

  it("attributes costs from message agent evidence rather than the session default", () => {
    const config: PricingConfig = {
      version: 1,
      prices: {
        "opencode/priced-model": { inputPerMTok: 5, outputPerMTok: 5, cacheReadPerMTok: 5, cacheWritePerMTok: 5, currency: "USD" },
        "opencode/unpriced-model": { inputPerMTok: 7, outputPerMTok: 7, cacheReadPerMTok: 7, cacheWritePerMTok: 7, currency: "USD" },
      },
      updatedAt: 1,
    };
    const result = costBreakdown(db, config);
    expect(result.byAgent).toEqual([
      { agent: "build", cost: { amount: 5, priced: true } },
      { agent: "message-plan", cost: { amount: 7, priced: true } },
    ]);
    expect(result.byAgent.some((entry) => entry.agent === "plan")).toBe(false);
  });

  it("rejects an unknown-role payload even when model and token fields look priceable", () => {
    db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('unknown-role', 'ses_1', 1704067200001, 1704067200001, ?)")
      .run(JSON.stringify({
        role: "future-role",
        agent: "build",
        providerID: "opencode",
        modelID: "priced-model",
        tokens: { input: 1_000_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }));
    const rate = { inputPerMTok: 5, outputPerMTok: 5, cacheReadPerMTok: 5, cacheWritePerMTok: 5, currency: "USD" as const };
    const result = costBreakdown(db, { version: 1, prices: { "opencode/priced-model": rate, "opencode/unpriced-model": rate }, updatedAt: 1 });

    expect(result.totalCost).toEqual({ amount: 0, priced: false });
    expect(result.byModel.find((entry) => entry.modelID === "priced-model")?.cost).toEqual({ amount: 0, priced: false });
    expect(result.bySession.find((entry) => entry.sessionId === "ses_1")?.cost).toEqual({ amount: 0, priced: false });
    expect(result.byAgent.find((entry) => entry.agent === "unknown")?.cost).toEqual({ amount: 0, priced: false });
  });

  it("rejects an assistant payload whose native token shape is incomplete", () => {
    db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('bad-tokens', 'ses_1', 1704067200001, 1704067200001, ?)")
      .run(JSON.stringify({
        role: "assistant",
        agent: "build",
        providerID: "opencode",
        modelID: "priced-model",
        tokens: { input: 1_000_000, output: 0, reasoning: 0, cache: { read: 0 } },
      }));
    const rate = { inputPerMTok: 5, outputPerMTok: 5, cacheReadPerMTok: 5, cacheWritePerMTok: 5, currency: "USD" as const };
    const result = costBreakdown(db, { version: 1, prices: { "opencode/priced-model": rate, "opencode/unpriced-model": rate }, updatedAt: 1 });

    expect(result.totalCost).toEqual({ amount: 0, priced: false });
    expect(result.byModel.find((entry) => entry.modelID === "priced-model")?.cost).toEqual({ amount: 0, priced: false });
    expect(result.bySession.find((entry) => entry.sessionId === "ses_1")?.cost).toEqual({ amount: 0, priced: false });
    expect(result.byAgent.find((entry) => entry.agent === "build")?.cost).toEqual({ amount: 0, priced: false });
  });

  it("marks fixture totals unpriced when malformed assistant evidence hides exact aggregate usage", () => {
    withFixture((fixture) => {
      const flatRate = { inputPerMTok: 1, outputPerMTok: 1, cacheReadPerMTok: 1, cacheWritePerMTok: 1, currency: "USD" as const };
      const config: PricingConfig = {
        version: 1,
        prices: Object.fromEntries([
          ...PROVIDER_MODELS.map((model) => [`${model.providerID}/${model.modelID}`, flatRate]),
          ["unknown/unknown", flatRate],
        ]),
        updatedAt: 1,
      };
      const sessionTotals = fixture.prepare(`
        SELECT SUM(tokens_input + tokens_output + tokens_cache_read + tokens_cache_write) / 1000000.0 AS amount
        FROM session
      `).get() as { amount: number };
      const validMessageTotals = fixture.prepare(`
        SELECT SUM(
          COALESCE(json_extract(data, '$.tokens.input'), 0) +
          COALESCE(json_extract(data, '$.tokens.output'), 0) +
          COALESCE(json_extract(data, '$.tokens.cache.read'), 0) +
          COALESCE(json_extract(data, '$.tokens.cache.write'), 0)
        ) / 1000000.0 AS amount
        FROM message
        WHERE json_valid(data) AND json_extract(data, '$.role') = 'assistant'
      `).get() as { amount: number };

      expect(sessionTotals.amount).toBeCloseTo(4.850602, 6);
      expect(validMessageTotals.amount).toBeCloseTo(4.848946, 6);
      expect(sessionTotals.amount - validMessageTotals.amount).toBeCloseTo(0.001656, 6);

      const result = costBreakdown(fixture, config);
      expect(result.totalCost).toEqual({ amount: 0, priced: false });
      expect(result.bySession.find((entry) => entry.sessionId === "ses_0000")?.cost).toEqual({ amount: 0, priced: false });
      expect(result.byAgent.find((entry) => entry.agent === "build")?.cost.amount).toBeCloseTo(2.946844, 6);
      expect(result.byAgent.find((entry) => entry.agent === "plan")?.cost.amount).toBeCloseTo(1.902102, 6);
      expect(result.byAgent.find((entry) => entry.agent === "unknown")?.cost).toEqual({ amount: 0, priced: false });
    });
  });
});
