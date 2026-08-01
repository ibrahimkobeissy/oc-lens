import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { toolActivity } from "@/lib/queries/tools";
import { FIXTURE_SCHEMA_SQL } from "@/test/fixtures/schema";

describe("OCL-074 tool activity", () => {
  it("uses tool calls, not sessions, as each day's error-rate denominator", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(FIXTURE_SCHEMA_SQL);
    db.prepare("INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('s', 'global', 's', '/', 'S', '1', 1, 1)").run();
    const insert = db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, 'm', 's', ?, ?, ?)");
    const at = Date.UTC(2026, 0, 2, 12);
    insert.run("ok-1", at, at, JSON.stringify({ type: "tool", tool: "read", callID: "1", state: { status: "completed", input: {} } }));
    insert.run("ok-2", at, at, JSON.stringify({ type: "tool", tool: "read", callID: "2", state: { status: "completed", input: {} } }));
    insert.run("bad", at, at, JSON.stringify({ type: "tool", tool: "bash", callID: "3", state: { status: "error", input: {}, output: "failed" } }));

    expect(toolActivity(db).data).toEqual([{ date: "2026-01-02", totalCalls: 3, errorCount: 1 }]);
    db.close();
  });
});
