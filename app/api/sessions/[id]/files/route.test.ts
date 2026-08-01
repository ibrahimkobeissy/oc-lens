import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as connectionModule from "@/lib/db/connection";
import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";
import { resetConnectionForTests } from "@/lib/db/connection";
import type { SessionFilesRouteResponse } from "@/types/oc";

import { dynamic, GET } from "./route";

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function payload(response: Response): Promise<SessionFilesRouteResponse> {
  return response.json() as Promise<SessionFilesRouteResponse>;
}

describe("GET /api/sessions/[id]/files", () => {
  let directory: string;
  let databasePath: string;
  let originalDb: string | undefined;

  beforeEach(() => {
    directory = makeTempDir();
    databasePath = join(directory, "files.db");
    createFullSchemaDb(databasePath);
    const db = new DatabaseSync(databasePath);
    db.prepare("UPDATE project SET worktree = '/repo' WHERE id = 'global'").run();
    db.close();
    originalDb = process.env.OC_LENS_DB;
    process.env.OC_LENS_DB = databasePath;
    resetConnectionForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetConnectionForTests();
    if (originalDb === undefined) delete process.env.OC_LENS_DB;
    else process.env.OC_LENS_DB = originalDb;
    cleanupTempDir(directory);
  });

  it("returns an ordered verified-source timeline and project worktree", async () => {
    const db = new DatabaseSync(databasePath);
    const insert = db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, 'msg_1', 'ses_1', ?, ?, ?)");
    insert.run("second", 20, 20, JSON.stringify({ type: "tool", tool: "edit", callID: "second", state: { status: "completed", input: {}, metadata: { filepath: "/repo/src/b.ts" } } }));
    insert.run("first", 10, 10, JSON.stringify({ type: "tool", tool: "write", callID: "first", state: { status: "completed", input: { filePath: "/repo/src/a.ts" } } }));
    db.close();
    resetConnectionForTests();

    const response = await GET(new Request("http://localhost/api/sessions/ses_1/files"), context("ses_1"));
    const body = await payload(response);

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    if (!("data" in body)) throw new Error("expected session files envelope");
    expect(body.data.projectWorktree).toBe("/repo");
    expect(body.data.changes.map((change) => [change.partId, change.filePath])).toEqual([
      ["first", "/repo/src/a.ts"], ["second", "/repo/src/b.ts"],
    ]);
  });

  it("returns an exact empty timeline when the session touched no files", async () => {
    const body = await payload(await GET(new Request("http://localhost/files"), context("ses_1")));
    expect(body).toMatchObject({ data: { changes: [], projectWorktree: "/repo" } });
  });

  it("propagates missing-path evidence warnings without inventing a touch", async () => {
    const db = new DatabaseSync(databasePath);
    db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('missing', 'msg_1', 'ses_1', 2, 2, ?)")
      .run(JSON.stringify({ type: "tool", tool: "edit", callID: "missing", state: { status: "completed", input: {} } }));
    db.close();
    resetConnectionForTests();

    const body = await payload(await GET(new Request("http://localhost/files"), context("ses_1")));
    if (!("data" in body)) throw new Error("expected session files envelope");
    expect(body.data.changes).toEqual([]);
    expect(body.meta.warnings).toContainEqual(expect.objectContaining({ code: "missing-file-path", count: 1 }));
  });

  it("returns sanitized invalid, missing, database, and schema states", async () => {
    expect((await GET(new Request("http://localhost/files"), context(""))).status).toBe(400);
    expect((await GET(new Request("http://localhost/files"), context("missing"))).status).toBe(404);

    const connection = vi.spyOn(connectionModule, "getConnection");
    connection.mockReturnValueOnce({ ok: false, reason: "not-found", searched: ["/private/missing.db"] });
    const missing = await GET(new Request("http://localhost/files"), context("ses_1"));
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain("/private/missing.db");

    connection.mockReturnValueOnce({ ok: false, reason: "schema-mismatch", mismatch: { table: "part", missingColumns: ["data"] } });
    expect((await GET(new Request("http://localhost/files"), context("ses_1"))).status).toBe(409);
  });
});
