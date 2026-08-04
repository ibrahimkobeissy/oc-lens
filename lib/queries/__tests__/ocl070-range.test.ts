import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { FIXTURE_SCHEMA_SQL } from "@/test/fixtures/schema";
import { agentUsage } from "../agents";
import { versionHistory } from "../projects";
import { featureAdoption } from "../tools";

function insertSession(db: DatabaseSync, id: string, version: string, time: number, parentId: string | null = null): void {
  db.prepare(
    "INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated) VALUES (?, 'global', ?, ?, '/', ?, ?, ?, ?)",
  ).run(id, parentId, id, id, version, time, time);
}

function insertMessage(db: DatabaseSync, id: string, sessionId: string, time: number, mode = "build"): void {
  db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
    .run(id, sessionId, time, time, JSON.stringify({ role: "assistant", mode }));
}

function insertPart(db: DatabaseSync, id: string, sessionId: string, messageId: string, time: number, data: unknown): void {
  db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, messageId, sessionId, time, time, JSON.stringify(data));
}

describe("OCL-070 range-aware query composition", () => {
  it("constrains feature sessions and every contributing message, todo, and part", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    insertSession(db, "old", "1.0", 10, "root");
    insertSession(db, "recent", "2.0", 110, "root");
    insertMessage(db, "old-message", "old", 10, "plan");
    insertMessage(db, "recent-message", "recent", 110, "plan");
    insertPart(db, "old-mcp", "old", "old-message", 10, { type: "tool", tool: "linear_docs_search", callID: "o", state: { status: "completed", input: {} } });
    insertPart(db, "recent-mcp", "recent", "recent-message", 110, { type: "tool", tool: "linear_docs_search", callID: "r", state: { status: "completed", input: {} } });
    insertPart(db, "old-reasoning", "old", "old-message", 10, { type: "reasoning", text: "old" });
    insertPart(db, "recent-reasoning", "recent", "recent-message", 110, { type: "reasoning", text: "recent" });
    db.prepare("INSERT INTO todo (session_id, content, status, position, time_created, time_updated) VALUES ('old', 'old', 'pending', 0, 10, 10)").run();
    db.prepare("INSERT INTO todo (session_id, content, status, position, time_created, time_updated) VALUES ('recent', 'recent', 'pending', 0, 110, 110)").run();

    const result = featureAdoption(db, ["linear", "linear_docs"], { from: 100, to: 120 }).data;

    expect(result.subagents).toMatchObject({ sessionCount: 1, pct: 1, firstUsed: 110 });
    expect(result.mcp).toMatchObject({ sessionCount: 1, pct: 1, firstUsed: 110 });
    expect(result.planMode).toMatchObject({ sessionCount: 1, pct: 1, firstUsed: 110 });
    expect(result.reasoning).toMatchObject({ sessionCount: 1, pct: 1, firstUsed: 110 });
    expect(result.todos).toMatchObject({ sessionCount: 1, pct: 1, firstUsed: 110 });
    db.close();
  });

  it("constrains version sessions and message counts independently", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    insertSession(db, "old", "1.0", 10);
    insertSession(db, "recent", "2.0", 110);
    insertMessage(db, "old-message", "old", 10);
    insertMessage(db, "recent-message", "recent", 110);
    insertMessage(db, "late-message", "recent", 130);
    insertMessage(db, "boundary-message", "recent", 120);
    insertSession(db, "boundary-session", "3.0", 120);

    expect(versionHistory(db, { from: 100, to: 120 }).data).toEqual([
      { version: "2.0", sessionCount: 1, messageCount: 1, firstSeen: 110, lastSeen: 110 },
    ]);
    db.close();
  });

  it("uses event-time activity for the adoption cohort and the first-used timestamp", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    insertSession(db, "old-active", "1.0", 10);
    insertSession(db, "idle", "1.0", 105);
    insertSession(db, "boundary", "1.0", 120);
    insertMessage(db, "old-active-message", "old-active", 110);
    insertMessage(db, "boundary-message", "boundary", 120);
    insertPart(db, "old-active-skill", "old-active", "old-active-message", 110, { type: "tool", tool: "skill", callID: "old", state: { status: "completed", input: { name: "audit" } } });
    insertPart(db, "boundary-skill", "boundary", "boundary-message", 120, { type: "tool", tool: "skill", callID: "boundary", state: { status: "completed", input: { name: "audit" } } });

    const result = featureAdoption(db, [], { from: 100, to: 120 }).data;
    expect(result.skills).toEqual({ sessionCount: 1, pct: 0.5, firstUsed: 110 });
    db.close();
  });

  it("excludes sessions exactly at the half-open upper boundary from agent analytics", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    insertSession(db, "inside", "1.0", 119);
    insertSession(db, "boundary", "1.0", 120);
    expect(agentUsage(db, { from: 100, to: 120 }).data.flatMap((row) => [...Array(row.sessionCount)])).toHaveLength(1);
    db.close();
  });

  it("warns when malformed message data would otherwise silently undercount plan mode", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    insertSession(db, "session", "1.0", 110);
    db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('bad', 'session', 110, 110, '{')").run();

    const result = featureAdoption(db, [], { from: 100, to: 120 });

    expect(result.data.planMode.sessionCount).toBe(0);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "malformed-message-data", count: 1 }));
    db.close();
  });
});
