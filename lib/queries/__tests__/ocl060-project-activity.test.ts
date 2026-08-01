import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { FIXTURE_SCHEMA_SQL } from "@/test/fixtures/schema";
import { dailyActivity } from "../activity";
import { projectDisplayName } from "../sessions";

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

    expect(dailyActivity(db, { projectId: "alpha", timeZone: "UTC" }).data).toEqual([
      { date: "2026-08-01", sessionCount: 1, messageCount: 1, toolCallCount: 1 },
    ]);
    db.close();
  });
});
