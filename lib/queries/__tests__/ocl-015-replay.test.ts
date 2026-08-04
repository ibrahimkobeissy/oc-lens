import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { LONG_SESSION_MESSAGE_COUNT, MCP_SERVERS, withFixture } from "@/test/fixtures";
import { PROVIDER_MODELS } from "@/test/fixtures/manifest";
import { FIXTURE_SCHEMA_SQL } from "@/test/fixtures/schema";
import type { PricingConfig } from "@/types/oc";
import { getReplay, subagentTree } from "../replay";

describe("OCL-015 replay queries", () => {
  it("orders messages and parts deterministically and accumulates step-finish tokens", () => withFixture((db) => {
    const id = (db.prepare("SELECT id FROM session ORDER BY id LIMIT 1").get() as { id: string }).id;
    const first = getReplay(db, id).data!;
    const second = getReplay(db, id).data!;
    expect(first.turns.map((t) => t.messageId)).toEqual(second.turns.map((t) => t.messageId));
    expect(first.turns).toHaveLength(LONG_SESSION_MESSAGE_COUNT);
    const ordered = db.prepare("SELECT id FROM message WHERE session_id = ? ORDER BY time_created, id").all(id) as Array<{ id: string }>;
    expect(first.turns.map((t) => t.messageId)).toEqual(ordered.map((r) => r.id));
    for (const turn of first.turns) {
      const expected = db.prepare("SELECT id FROM part WHERE message_id = ? ORDER BY time_created, id").all(turn.messageId) as Array<{ id: string }>;
      expect(turn.parts.map((p) => p.id)).toEqual(expected.map((r) => r.id));
    }
    const last = first.tokenAccumulation.at(-1)?.tokens;
    expect(last).toEqual(first.session.tokens);
    expect(first.turns.some((turn) => turn.timeCompleted === null && turn.durationMs === null)).toBe(true);
  }));

  it("applies the frozen SessionSummary placeholder-title fallback", () => withFixture((db) => {
    const row = db.prepare("SELECT id, slug FROM session WHERE title LIKE 'New session - %' ORDER BY id LIMIT 1").get() as { id: string; slug: string };
    const replay = getReplay(db, row.id).data!;
    expect(replay.session.title).toMatch(/^Fixture user prompt/);
    expect(replay.session.title).not.toBe(row.slug);
  }));

  it("sets the replay MCP badge using configured server names", () => withFixture((db) => {
    const row = db.prepare("SELECT session_id FROM part WHERE data LIKE '%linear_docs_search%' LIMIT 1").get() as { session_id: string };
    const servers = Object.values(MCP_SERVERS).map((entry) => entry.server);
    expect(getReplay(db, row.session_id, servers).data?.session.usesMcp).toBe(true);
  }));

  it("prices each turn from that message's model and tokens only when pricing is supplied", () => withFixture((db) => {
    const id = (db.prepare("SELECT id FROM session ORDER BY id LIMIT 1").get() as { id: string }).id;
    const pricing: PricingConfig = {
      version: 1,
      updatedAt: 1,
      prices: Object.fromEntries(PROVIDER_MODELS.map(({ providerID, modelID }) => [
        `${providerID}/${modelID}`,
        { inputPerMTok: 1, outputPerMTok: 2, cacheReadPerMTok: 3, cacheWritePerMTok: 4, currency: "USD" as const },
      ])),
    };
    const withoutPricing = getReplay(db, id).data!;
    const withPricing = getReplay(db, id, [], pricing).data!;
    const pricedIndex = withPricing.turns.findIndex((turn) => turn.cost.priced);

    expect(withoutPricing.turns.every((turn) => !turn.cost.priced)).toBe(true);
    expect(pricedIndex).toBeGreaterThanOrEqual(0);
    const pricedTurn = withPricing.turns[pricedIndex]!;
    const usage = pricedTurn.tokens!;
    expect(pricedTurn.cost.priced).toBe(true);
    expect(pricedTurn.cost.amount).toBeCloseTo((usage.input + usage.output * 2 + usage.cacheRead * 3 + usage.cacheWrite * 4) / 1_000_000, 12);
    expect(withPricing.turns.filter((turn) => turn.role === "user").every((turn) => !turn.cost.priced)).toBe(true);
  }));

  it("does not price a non-assistant message with otherwise valid-looking model and token fields", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    db.prepare("INSERT INTO project (id, worktree, name) VALUES ('global', '/', NULL)").run();
    db.prepare("INSERT INTO session (id, project_id, slug, directory, title, version, agent, time_created, time_updated) VALUES ('s', 'global', 's', '/', 's', '1', 'build', 1, 2)").run();
    db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('m', 's', 1, 2, ?)").run(JSON.stringify({
      role: "future-role",
      agent: "build",
      providerID: "provider",
      modelID: "model",
      tokens: { input: 1_000_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }));
    const pricing: PricingConfig = { version: 1, updatedAt: 1, prices: { "provider/model": { inputPerMTok: 1, outputPerMTok: 1, cacheReadPerMTok: 1, cacheWritePerMTok: 1, currency: "USD" } } };
    expect(getReplay(db, "s", [], pricing).data?.turns[0]?.cost).toEqual({ amount: 0, priced: false });
    db.close();
  });

  it("sets the replay summary compaction flag from the verified fixture part", () => withFixture((db) => {
    const row = db.prepare("SELECT session_id FROM part WHERE json_extract(data, '$.type') = 'compaction' LIMIT 1").get() as { session_id: string };
    expect(getReplay(db, row.session_id).data?.session.hasCompaction).toBe(true);
  }));

  it("replays the 400-message fixture session in under 300ms", () => withFixture((db) => {
    const id = (db.prepare("SELECT id FROM session ORDER BY id LIMIT 1").get() as { id: string }).id;
    const started = performance.now();
    expect(getReplay(db, id).data?.turns).toHaveLength(400);
    expect(performance.now() - started).toBeLessThan(300);
  }));

  it("builds subagent trees from parent_id", () => withFixture((db) => {
    const parent = db.prepare("SELECT parent_id FROM session WHERE parent_id IS NOT NULL LIMIT 1").get() as { parent_id: string };
    const tree = subagentTree(db, parent.parent_id);
    expect(tree.data?.sessionId).toBe(parent.parent_id);
    expect(tree.data?.children.length).toBeGreaterThan(0);
  }));

  it("terminates a deliberate parent cycle and emits a warning", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oc-lens-cycle-"));
    const db = new DatabaseSync(path.join(dir, "cycle.db"));
    try {
      db.exec(FIXTURE_SCHEMA_SQL);
      db.prepare("INSERT INTO project (id, worktree, name, time_created, time_updated) VALUES ('p', '/p', 'p', 1, 1)").run();
      const insert = db.prepare(`INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, agent, model, time_created, time_updated) VALUES (?, 'p', ?, ?, '/p', ?, '1', 0, 0, 0, 0, 0, 0, 'build', NULL, 1, 2)`);
      insert.run("a", "b", "a", "a"); insert.run("b", "a", "b", "b");
      const result = subagentTree(db, "a");
      expect(result.data?.children[0]?.sessionId).toBe("b");
      expect(result.data?.children[0]?.children).toEqual([]);
      expect(result.warnings.some((w) => w.code === "subagent-cycle")).toBe(true);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("returns null cleanly when the requested session does not exist", () => withFixture((db) => {
    expect(getReplay(db, "missing")).toEqual({ data: null, warnings: [] });
    expect(subagentTree(db, "missing")).toEqual({ data: null, warnings: [] });
  }));
});
