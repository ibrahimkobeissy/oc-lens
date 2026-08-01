import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { FIXTURE_SCHEMA_SQL } from "@/test/fixtures/schema";
import { skillUsage } from "../tools";

describe("OCL-102 skillUsage", () => {
  it("buckets missing names and computes nearest-rank durations", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    db.prepare(
      "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('session', 'global', 'session', '/', 'Session', '1', 1, 2)",
    ).run();
    const insert = db.prepare(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, 'session', ?, ?, ?)",
    );
    const call = (id: string, input: unknown, status: string, start?: number, end?: number) => insert.run(
      id,
      `message-${id}`,
      Number(id.slice(1)),
      Number(id.slice(1)),
      JSON.stringify({ type: "tool", tool: "skill", callID: id, state: { status, input, time: { start, end } } }),
    );
    call("p1", { name: "review" }, "completed", 0, 10);
    call("p2", { name: "review" }, "error", 0, 30);
    call("p3", { name: "review" }, "completed", 0, 20);
    call("p4", {}, "completed", 0, 5);
    call("p5", { name: "   " }, "completed");

    expect(skillUsage(db).data).toEqual([
      { skill: "review", totalCalls: 3, sessionCount: 1, errorCount: 1, p50DurationMs: 20, p95DurationMs: 30 },
      { skill: "unknown", totalCalls: 2, sessionCount: 1, errorCount: 0, p50DurationMs: 5, p95DurationMs: 5 },
    ]);
    db.close();
  });
});
