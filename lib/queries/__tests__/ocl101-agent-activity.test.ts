import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { FIXTURE_SCHEMA_SQL } from "@/test/fixtures/schema";
import { agentActivity, agentUsage } from "../agents";

describe("OCL-101 agent activity", () => {
  it("groups decoded message agents by UTC day and keeps missing agents explicit", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    const insert = db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, 'session', ?, ?, ?)");
    const first = Date.UTC(2026, 7, 1, 23, 30);
    const second = Date.UTC(2026, 7, 2, 0, 30);
    insert.run("a", first, first, JSON.stringify({ role: "assistant", agent: "build", time: { created: first } }));
    insert.run("b", first + 1, first + 1, JSON.stringify({ role: "user", agent: "build", time: { created: first + 1 } }));
    insert.run("c", second, second, JSON.stringify({ role: "user", time: { created: second } }));

    expect(agentActivity(db)).toEqual({
      data: [
        { date: "2026-08-01", agent: "build", messageCount: 2 },
        { date: "2026-08-02", agent: "unknown", messageCount: 1 },
      ],
      warnings: [],
    });
    db.close();
  });

  it("does not expose a partial cost when an agent has mixed priced and unpriced usage", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    db.prepare("INSERT INTO session (id, project_id, slug, directory, title, version, agent, time_created, time_updated) VALUES ('s', 'global', 's', '/', 's', '1', 'build', 1, 2)").run();
    const insert = db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, 's', ?, ?, ?)");
    const usage = { input: 1_000_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
    insert.run("priced", 1, 1, JSON.stringify({ role: "assistant", agent: "build", providerID: "openai", modelID: "priced", tokens: usage }));
    insert.run("unpriced", 2, 2, JSON.stringify({ role: "assistant", agent: "build", providerID: "openai", modelID: "unpriced", tokens: usage }));

    const result = agentUsage(db, {}, {
      version: 1,
      prices: { "openai/priced": { inputPerMTok: 2, outputPerMTok: 0, cacheReadPerMTok: 0, cacheWritePerMTok: 0, currency: "USD" } },
      updatedAt: 0,
    });

    expect(result.data.find((row) => row.agent === "build")?.cost).toEqual({ amount: 0, priced: false });
    db.close();
  });
});
