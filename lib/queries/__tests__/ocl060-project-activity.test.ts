import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { FIXTURE_SCHEMA_SQL } from "@/test/fixtures/schema";
import { dailyActivity, dailyTokens, dayOfWeek, hourOfDay } from "../activity";
import { projectModelBreakdown } from "../projects";
import { projectDisplayName } from "../sessions";
import type { PricingConfig } from "@/types/oc";

describe("OCL-060 project activity scope", () => {
  it("uses the frozen name, basename, global, then id display-name fallback", () => {
    expect(projectDisplayName("global", "Named", "/work/tree")).toBe("Named");
    expect(projectDisplayName("global", null, "/work/tree")).toBe("tree");
    expect(projectDisplayName("global", null, "/")).toBe("global");
    expect(projectDisplayName("project-id", null, null)).toBe("project-id");
  });

  it("constrains sessions, messages, and tool parts to the requested project", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    const at = Date.UTC(2026, 7, 1, 12);
    const insertProject = db.prepare("INSERT INTO project (id, worktree, name) VALUES (?, ?, ?)");
    const insertSession = db.prepare(
      "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (?, ?, ?, '/', ?, '1', ?, ?)",
    );
    const insertMessage = db.prepare(
      "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
    );
    const insertPart = db.prepare(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const project of ["alpha", "beta"]) {
      insertProject.run(project, `/${project}`, project);
      insertSession.run(`ses-${project}`, project, project, project, at, at + 2);
      insertMessage.run(`msg-${project}`, `ses-${project}`, at, at + 1, JSON.stringify({ role: "user", time: { created: at } }));
      insertPart.run(
        `part-${project}`,
        `msg-${project}`,
        `ses-${project}`,
        at,
        at + 1,
        JSON.stringify({ type: "tool", tool: "read", callID: `call-${project}`, state: { status: "completed", input: {} } }),
      );
    }
    db.prepare("UPDATE session SET tokens_input = 11, tokens_output = 7, tokens_cache_read = 5 WHERE id = 'ses-alpha'").run();
    db.prepare("UPDATE session SET tokens_input = 999, tokens_output = 999 WHERE id = 'ses-beta'").run();

    const range = { projectId: "alpha", timeZone: "UTC" };
    expect(dailyActivity(db, range).data).toEqual([
      { date: "2026-08-01", sessionCount: 1, messageCount: 1, toolCallCount: 1 },
    ]);
    expect(hourOfDay(db, range).data.filter((bucket) => bucket.count > 0)).toEqual([{ hour: 12, count: 1 }]);
    expect(dayOfWeek(db, range).data.filter((bucket) => bucket.count > 0)).toEqual([{ day: 6, count: 1 }]);
    expect(dailyTokens(db, range).data).toEqual([{
      date: "2026-08-01",
      tokens: { input: 11, output: 7, reasoning: 0, cacheRead: 5, cacheWrite: 0 },
    }]);
    db.close();
  });

  it("derives project models from message evidence across switches, unknowns, and pricing states", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    db.exec(`
      INSERT INTO project (id, worktree, name) VALUES ('alpha', '/alpha', 'alpha'), ('beta', '/beta', 'beta');
      INSERT INTO session (id, project_id, slug, directory, title, version, model, time_created, time_updated)
      VALUES ('ses-alpha', 'alpha', 'alpha', '/', 'alpha', '1', '{"id":"wrong-session-model","providerID":"session-provider","variant":"default"}', 1, 2),
             ('ses-beta', 'beta', 'beta', '/', 'beta', '1', NULL, 1, 2);
    `);
    const insert = db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)");
    insert.run("a-1", "ses-alpha", 10, 10, JSON.stringify({ role: "assistant", providerID: "provider-a", modelID: "model-a", tokens: { input: 1_000_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }));
    insert.run("a-2", "ses-alpha", 11, 11, JSON.stringify({ role: "assistant", providerID: "provider-a", modelID: "model-a", tokens: { input: 0, output: 500_000, reasoning: 0, cache: { read: 0, write: 0 } } }));
    insert.run("b-1", "ses-alpha", 12, 12, JSON.stringify({ role: "assistant", providerID: "provider-b", modelID: "model-b", tokens: { input: 250_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }));
    insert.run("unknown", "ses-alpha", 13, 13, JSON.stringify({ role: "user", time: { created: 13 } }));
    insert.run("outside", "ses-beta", 14, 14, JSON.stringify({ role: "assistant", providerID: "provider-z", modelID: "outside", tokens: { input: 9_000_000 } }));

    const partial: PricingConfig = {
      version: 1,
      updatedAt: 1,
      prices: {
        "provider-a/model-a": { inputPerMTok: 2, outputPerMTok: 4, cacheReadPerMTok: 0, cacheWritePerMTok: 0, currency: "USD" },
      },
    };
    const result = projectModelBreakdown(db, "alpha", partial);

    expect(result.data.map((model) => `${model.providerID}/${model.modelID}`)).toEqual(["provider-a/model-a", "provider-b/model-b", "unknown/unknown"]);
    expect(result.data.find((model) => model.modelID === "model-a")).toMatchObject({ sessionCount: 1, messageCount: 2, cost: { amount: 4, priced: true } });
    expect(result.data.find((model) => model.modelID === "model-b")?.cost).toEqual({ amount: 0, priced: false });
    expect(result.data.find((model) => model.modelID === "unknown")?.cost).toEqual({ amount: 0, priced: false });
    expect(result.data.some((model) => model.modelID === "wrong-session-model" || model.modelID === "outside")).toBe(false);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "unknown-message-model", count: 1 }));

    const fullyPriced = projectModelBreakdown(db, "alpha", {
      ...partial,
      prices: {
        ...partial.prices,
        "provider-b/model-b": { inputPerMTok: 8, outputPerMTok: 0, cacheReadPerMTok: 0, cacheWritePerMTok: 0, currency: "USD" },
      },
    });
    expect(fullyPriced.data.filter((model) => model.modelID !== "unknown").every((model) => model.cost.priced)).toBe(true);
    expect(projectModelBreakdown(db, "alpha", { version: 1, updatedAt: 1, prices: {} }).data.every((model) => !model.cost.priced)).toBe(true);
    db.close();
  });
});
