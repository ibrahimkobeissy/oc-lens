import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";
import { fileChanges, filesMostTouched } from "@/lib/queries/tools";
import { withFixture } from "@/test/fixtures";
import type { FileChangeSummary } from "@/types/oc";

describe("OCL-103 verified tool-call fallback", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach(cleanupTempDir));

  it("extracts only verified mutation-tool paths in stable timeline order", () => {
    const directory = makeTempDir(); directories.push(directory);
    const path = join(directory, "files.db"); createFullSchemaDb(path);
    const writable = new DatabaseSync(path);
    const insert = writable.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, 'msg_1', 'ses_1', ?, ?, ?)");
    insert.run("later", 30, 30, JSON.stringify({ type: "tool", tool: "edit", callID: "later", state: { status: "completed", input: {}, metadata: { filepath: "/repo/src/b.ts" }, time: { start: 30, end: 31 } } }));
    insert.run("first-b", 10, 10, JSON.stringify({ type: "tool", tool: "write", callID: "first-b", state: { status: "completed", input: { filePath: "/repo/src/b.ts" }, time: { start: 10, end: 11 } } }));
    insert.run("first-a", 10, 10, JSON.stringify({ type: "tool", tool: "patch", callID: "first-a", state: { status: "completed", input: { filePath: "/repo/src/a.ts" }, time: { start: 10, end: 11 } } }));
    insert.run("metadata-wins", 35, 35, JSON.stringify({ type: "tool", tool: "edit", callID: "metadata-wins", state: { status: "completed", input: { filePath: "src/relative.ts" }, metadata: { filepath: "/repo/src/actual.ts" } } }));
    insert.run("failed", 36, 36, JSON.stringify({ type: "tool", tool: "write", callID: "failed", state: { status: "error", input: { filePath: "/repo/not-touched.ts" } } }));
    insert.run("running", 37, 37, JSON.stringify({ type: "tool", tool: "edit", callID: "running", state: { status: "running", input: { filePath: "/repo/not-yet-touched.ts" } } }));
    insert.run("read", 5, 5, JSON.stringify({ type: "tool", tool: "read", callID: "read", state: { status: "completed", input: { filePath: "/repo/ignored.ts" } } }));
    insert.run("blank", 40, 40, JSON.stringify({ type: "tool", tool: "write", callID: "blank", state: { status: "completed", input: { filePath: "" } } }));
    writable.close();

    const db = new DatabaseSync(path, { readOnly: true });
    const result = fileChanges(db, "ses_1"); db.close();

    expect(result.data.map((change) => [change.partId, change.filePath, change.tool])).toEqual([
      ["first-a", "/repo/src/a.ts", "patch"],
      ["first-b", "/repo/src/b.ts", "write"],
      ["later", "/repo/src/b.ts", "edit"],
      ["metadata-wins", "/repo/src/actual.ts", "edit"],
    ]);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "missing-file-path", count: 1 }));
  });

  it("warns rather than claiming a categorical empty result when the only completed mutation lacks a path", () => {
    const directory = makeTempDir(); directories.push(directory);
    const path = join(directory, "empty-files.db"); createFullSchemaDb(path);
    const writable = new DatabaseSync(path);
    writable.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('missing', 'msg_1', 'ses_1', 2, 2, ?)")
      .run(JSON.stringify({ type: "tool", tool: "write", callID: "missing", state: { status: "completed", input: {} } }));
    writable.close();
    const db = new DatabaseSync(path, { readOnly: true });
    const result = fileChanges(db, "ses_1");
    expect(result.data).toEqual([]);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "missing-file-path", count: 1 }));
    db.close();
  });

  it("matches the fixture's exact completed mutation evidence and excludes every non-completed attempt", () => {
    withFixture((db) => {
      const sessionIds = (db.prepare("SELECT id FROM session ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id);
      const changes = sessionIds.flatMap((sessionId) => fileChanges(db, sessionId).data);
      const excludedIds = new Set((db.prepare(`
        SELECT id FROM part
        WHERE json_extract(data, '$.type') = 'tool'
          AND json_extract(data, '$.tool') IN ('write', 'edit', 'patch')
          AND json_extract(data, '$.state.status') <> 'completed'
      `).all() as Array<{ id: string }>).map((row) => row.id));
      expect(changes).toHaveLength(305);
      expect(excludedIds.size).toBe(39);
      expect(changes.some((change) => excludedIds.has(change.partId))).toBe(false);
    });
  });

  it("rolls up an already project-scoped change set without querying or guessing", () => {
    const changes: FileChangeSummary[] = [
      { sessionId: "s1", filePath: "/repo/a.ts", tool: "write", timeCreated: 10, partId: "1" },
      { sessionId: "s1", filePath: "/repo/a.ts", tool: "edit", timeCreated: 20, partId: "2" },
      { sessionId: "s2", filePath: "/repo/a.ts", tool: "edit", timeCreated: 30, partId: "3" },
      { sessionId: "s1", filePath: "/repo/b.ts", tool: "write", timeCreated: 40, partId: "4" },
    ];
    expect(filesMostTouched(changes)).toEqual([
      { filePath: "/repo/a.ts", touchCount: 3, sessionCount: 2, lastTouched: 30 },
      { filePath: "/repo/b.ts", touchCount: 1, sessionCount: 1, lastTouched: 40 },
    ]);
  });
});
