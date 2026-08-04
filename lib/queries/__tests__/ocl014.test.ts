import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { dailyActivity, dailyTokens, dayOfWeek, hourOfDay, streaks } from "../activity";
import { getOverviewStats, listProjects, versionHistory } from "../projects";
import { getSession, listSessions } from "../sessions";
import { FIXTURE_SCHEMA_SQL } from "../../../test/fixtures/schema";
import { GLOBAL_PROJECT_ID, MINIMUMS, withEmptyFixture, withFixture } from "../../../test/fixtures";

describe("OCL-014 session queries", () => {
  it("returns every fixture session with honest null buckets and badge/count data", () => {
    withFixture((db) => {
      const result = listSessions(db, { mcpServers: ["serena", "linear_docs"] });
      const expected = (db.prepare("SELECT COUNT(*) AS count FROM session").get() as { count: number }).count;
      expect(result.data).toHaveLength(expected);
      expect(result.data.filter((s) => s.agent === null).length).toBeGreaterThanOrEqual(MINIMUMS.nullAgentSessions);
      expect(result.data.filter((s) => s.model === null).length).toBeGreaterThanOrEqual(MINIMUMS.nullModelSessions);
      expect(result.data.some((s) => s.hasReasoning)).toBe(true);
      expect(result.data.some((s) => s.hasCompaction)).toBe(true);
      expect(result.data.some((s) => s.usesMcp)).toBe(true);
      expect(result.data.some((s) => s.usesSubagent)).toBe(true);
      expect(result.data.some((s) => s.usesWebfetch)).toBe(true);
      expect(result.warnings.find((warning) => warning.code === "unknown-agent")?.count).toBeGreaterThanOrEqual(MINIMUMS.nullAgentSessions);
      const first = result.data[0];
      expect(first).toBeDefined();
      if (first) {
        const raw = db.prepare("SELECT tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write FROM session WHERE id = ?").get(first.id) as { tokens_input: number; tokens_output: number; tokens_reasoning: number; tokens_cache_read: number; tokens_cache_write: number };
        const roles = db.prepare("SELECT data FROM message WHERE session_id = ?").all(first.id) as Array<{ data: string }>;
        const roleCounts = roles.reduce((counts, row) => {
          try { const role = (JSON.parse(row.data) as { role?: string }).role; if (role === "user") counts.user += 1; if (role === "assistant") counts.assistant += 1; } catch { /* deliberately malformed fixture row */ }
          return counts;
        }, { user: 0, assistant: 0 });
        expect(first.tokens).toEqual({ input: raw.tokens_input, output: raw.tokens_output, reasoning: raw.tokens_reasoning, cacheRead: raw.tokens_cache_read, cacheWrite: raw.tokens_cache_write });
        expect(first.messageCounts).toEqual(roleCounts);
      }
    });
  });

  it("falls back to the slug when a placeholder session has no user text", () => {
    const db = new DatabaseSync(":memory:"); db.exec(FIXTURE_SCHEMA_SQL);
    db.prepare("INSERT INTO project (id, worktree, name) VALUES ('global', '/', NULL)").run();
    db.prepare("INSERT INTO session (id, project_id, slug, directory, title, version, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated) VALUES ('no-text', 'global', 'plain-slug', '/', 'New session - 2026-01-02T23:30:00.000Z', '1', 0, 0, 0, 0, 0, 0, 1, 2)").run();
    db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('assistant', 'no-text', 1, 2, ?)").run(JSON.stringify({ role: "assistant", time: { created: 1, completed: 2 } }));
    expect(listSessions(db).data[0]?.title).toBe("plain-slug"); db.close();
  });

  it("falls placeholder titles back to first user text and exposes parent/children", () => {
    withFixture((db) => {
      const placeholder = db.prepare("SELECT id, slug FROM session WHERE title LIKE 'New session - %' LIMIT 1").get() as { id: string; slug: string };
      const summary = listSessions(db).data.find((s) => s.id === placeholder.id);
      expect(summary?.title).toMatch(/^Fixture user prompt/);
      expect(summary?.title).not.toBe(placeholder.slug);

      const parent = db.prepare("SELECT parent_id FROM session WHERE parent_id IS NOT NULL LIMIT 1").get() as { parent_id: string };
      const detail = getSession(db, parent.parent_id).data;
      expect(detail?.childIds.length).toBeGreaterThan(0);
    });
  });

  it("filters and completes the populated fixture within the ticket budget", () => {
    withFixture((db) => {
      const start = performance.now();
      const result = listSessions(db, { search: "fixture" });
      expect(result.data.length).toBeGreaterThan(0);
      expect(performance.now() - start).toBeLessThan(150);
    });
  });

  it("treats percent, underscore, and backslash as literal session-search text", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    db.prepare("INSERT INTO project (id, worktree, name) VALUES ('global', '/', NULL)").run();
    const insert = db.prepare(`
      INSERT INTO session (
        id, project_id, slug, directory, title, version, cost,
        tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
        time_created, time_updated
      ) VALUES (?, 'global', ?, '/', ?, '1', 0, 0, 0, 0, 0, 0, ?, ?)
    `);
    insert.run("percent", "percent", "literal % marker", 1, 1);
    insert.run("underscore", "underscore", "literal _ marker", 2, 2);
    insert.run("backslash", "backslash", "literal \\ marker", 3, 3);
    insert.run("plain", "plain", "literal marker", 4, 4);

    expect(listSessions(db, { search: "%" }).data.map((session) => session.id)).toEqual(["percent"]);
    expect(listSessions(db, { search: "_" }).data.map((session) => session.id)).toEqual(["underscore"]);
    expect(listSessions(db, { search: "\\" }).data.map((session) => session.id)).toEqual(["backslash"]);
    db.close();
  });
});

describe("OCL-014 project and overview queries", () => {
  it("uses the documented global display name and exact SQL counts", () => {
    withFixture((db) => {
      const projects = listProjects(db).data;
      const global = projects.find((p) => p.id === GLOBAL_PROJECT_ID);
      const expectedSessions = (db.prepare("SELECT COUNT(*) AS count FROM session WHERE project_id = ?").get(GLOBAL_PROJECT_ID) as { count: number }).count;
      expect(global?.displayName).toBe("global");
      expect(global?.sessionCount).toBe(expectedSessions);
      const expectedMessages = (db.prepare("SELECT COUNT(*) AS count FROM message m JOIN session s ON s.id = m.session_id WHERE s.project_id = ?").get(GLOBAL_PROJECT_ID) as { count: number }).count;
      expect(global?.messageCount).toBe(expectedMessages);
    });
  });

  it("flows strict configured pricing into project summaries", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    db.prepare("INSERT INTO project (id, worktree, name) VALUES ('global', '/', NULL)").run();
    db.prepare("INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('s', 'global', 's', '/', 's', '1', 1, 2)").run();
    db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('m', 's', 1, 2, ?)").run(JSON.stringify({ role: "assistant", providerID: "provider", modelID: "model", tokens: { input: 1_000_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }));
    const pricing = { version: 1 as const, updatedAt: 1, prices: { "provider/model": { inputPerMTok: 1, outputPerMTok: 1, cacheReadPerMTok: 1, cacheWritePerMTok: 1, currency: "USD" as const } } };
    expect(listProjects(db, {}, pricing).data[0]?.cost).toEqual({ amount: 1, priced: true });
    db.close();
  });

  it("computes overview totals and explicit unknown counts", () => {
    withFixture((db) => {
      const overview = getOverviewStats(db, "UTC", Date.UTC(2027, 0, 1)).data;
      const expectedMessages = (db.prepare("SELECT COUNT(*) AS count FROM message").get() as { count: number }).count;
      expect(overview.totalSessions).toBeGreaterThanOrEqual(MINIMUMS.sessions);
      expect(overview.totalMessages).toBe(expectedMessages);
      expect(overview.unknownAgentCount).toBeGreaterThanOrEqual(MINIMUMS.nullAgentSessions);
      expect(overview.unknownModelCount).toBeGreaterThanOrEqual(MINIMUMS.nullModelSessions);
      expect(overview.totalCost.priced).toBe(false);
    });
  });

  it("groups version history with hand-checked session totals", () => {
    withFixture((db) => {
      const history = versionHistory(db).data;
      expect(history).toHaveLength(1);
      expect(history[0]?.version).toBe("1.17.7");
      expect(history[0]?.sessionCount).toBe(120);
    });
  });
});

describe("OCL-014 timezone-aware activity", () => {
  it("places 23:30 UTC on different calendar days in UTC and Pacific/Auckland", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    const at = Date.UTC(2026, 0, 2, 23, 30);
    db.prepare("INSERT INTO session (id, project_id, slug, directory, title, version, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated) VALUES (?, 'global', 'late', '/', 'Late', '1', 0, 1, 2, 3, 4, 5, ?, ?)").run("late", at, at);
    expect(dailyActivity(db, { timeZone: "UTC" }).data[0]?.date).toBe("2026-01-02");
    expect(dailyActivity(db, { timeZone: "Pacific/Auckland" }).data[0]?.date).toBe("2026-01-03");
    db.close();
  });

  it("keeps in-range messages and tools from a session that started before the range", () => {
    const db = new DatabaseSync(":memory:"); db.exec(FIXTURE_SCHEMA_SQL);
    const start = Date.UTC(2026, 0, 1); const event = Date.UTC(2026, 0, 2, 12);
    db.prepare("INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('crossing', 'global', 'crossing', '/', 'Crossing', '1', ?, ?)").run(start, event);
    db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('later', 'crossing', ?, ?, ?)").run(event, event, JSON.stringify({ role: "user", time: { created: event } }));
    db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('tool', 'later', 'crossing', ?, ?, ?)").run(event, event, JSON.stringify({ type: "tool", tool: "read", callID: "c", state: { status: "completed", input: {}, time: { start: event, end: event + 1 } } }));
    const day = dailyActivity(db, { from: Date.UTC(2026, 0, 2), to: Date.UTC(2026, 0, 3), timeZone: "UTC" }).data[0];
    expect(day).toEqual({ date: "2026-01-02", sessionCount: 0, messageCount: 1, toolCallCount: 1 }); db.close();
  });

  it("returns complete hour/day buckets, token days, and streak metadata", () => {
    withFixture((db) => {
      const hours = hourOfDay(db, { timeZone: "Europe/Paris" }).data;
      expect(hours).toHaveLength(24);
      expect(hours.reduce((total, bucket) => total + bucket.count, 0)).toBe(120);
      expect(dayOfWeek(db, { timeZone: "Europe/Paris" }).data).toHaveLength(7);
      expect(dailyTokens(db, { timeZone: "Europe/Paris" }).data.length).toBeGreaterThan(0);
      expect(streaks(db, "Europe/Paris").data.totalActiveDays).toBeGreaterThan(0);
    });
  });
});

describe("OCL-014 empty fixture", () => {
  it("all query functions return clean zero/empty values", () => {
    withEmptyFixture((db) => {
      expect(listSessions(db).data).toEqual([]);
      expect(getSession(db, "missing").data).toBeNull();
      expect(listProjects(db).data).toEqual([]);
      expect(dailyActivity(db).data).toEqual([]);
      expect(dailyTokens(db).data).toEqual([]);
      expect(hourOfDay(db).data.every((b) => b.count === 0)).toBe(true);
      expect(dayOfWeek(db).data.every((b) => b.count === 0)).toBe(true);
      expect(streaks(db).data.totalActiveDays).toBe(0);
      expect(versionHistory(db).data).toEqual([]);
      expect(getOverviewStats(db).data.totalSessions).toBe(0);
    });
  });
});
