import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";
import type { PricingConfig } from "@/types/oc";
import { listPricableModels } from "../models";

describe("listPricableModels", () => {
  let dir: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dir = makeTempDir();
    const dbPath = join(dir, "test.db");
    createFullSchemaDb(dbPath);
    db = new DatabaseSync(dbPath);
    // The fixture seeds one message with data = '{}' (no providerID/modelID — must be skipped).
    // Two assistant messages across two distinct models, plus one with malformed JSON and one user message (no modelID).
    db.exec(`
      INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES
        ('msg_a1', 'ses_1', 1, 1, '${JSON.stringify({
          role: "assistant",
          providerID: "opencode",
          modelID: "deepseek-v4-flash-free",
          tokens: { input: 1000, output: 200, reasoning: 0, cache: { read: 500, write: 0 } },
        })}'),
        ('msg_a2', 'ses_1', 2, 2, '${JSON.stringify({
          role: "assistant",
          providerID: "opencode",
          modelID: "deepseek-v4-flash-free",
          tokens: { input: 2000, output: 300, reasoning: 0, cache: { read: 0, write: 0 } },
        })}'),
        ('msg_b1', 'ses_1', 3, 3, '${JSON.stringify({
          role: "assistant",
          providerID: "anthropic",
          modelID: "sonnet",
          tokens: { input: 500, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
        })}'),
        ('msg_user', 'ses_1', 4, 4, '${JSON.stringify({ role: "user" })}'),
        ('msg_bad', 'ses_1', 5, 5, '{not valid json');
    `);
  });

  afterEach(() => {
    db.close();
    cleanupTempDir(dir);
  });

  it("aggregates token volume per distinct providerID/modelID, skipping non-assistant and malformed rows", () => {
    const config: PricingConfig = { version: 1, prices: {}, updatedAt: 1 };
    const models = listPricableModels(db, config);

    const byKey = new Map(models.map((m) => [m.key, m]));
    expect(byKey.size).toBe(2);

    const deepseek = byKey.get("opencode/deepseek-v4-flash-free");
    expect(deepseek).toBeDefined();
    expect(deepseek?.tokens).toEqual({ input: 3000, output: 500, reasoning: 0, cacheRead: 500, cacheWrite: 0 });
    expect(deepseek?.priced).toBe(false);

    const sonnet = byKey.get("anthropic/sonnet");
    expect(sonnet?.tokens).toEqual({ input: 500, output: 100, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it("marks a model priced:true when the config has a rate for its key", () => {
    const config: PricingConfig = {
      version: 1,
      prices: {
        "anthropic/sonnet": {
          inputPerMTok: 3,
          outputPerMTok: 15,
          cacheReadPerMTok: 0.3,
          cacheWritePerMTok: 3.75,
          currency: "USD",
        },
      },
      updatedAt: 1,
    };
    const models = listPricableModels(db, config);
    const sonnet = models.find((m) => m.key === "anthropic/sonnet");
    const deepseek = models.find((m) => m.key === "opencode/deepseek-v4-flash-free");
    expect(sonnet?.priced).toBe(true);
    expect(deepseek?.priced).toBe(false);
  });
});
