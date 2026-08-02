import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as connectionModule from "@/lib/db/connection";
import { resetConnectionForTests } from "@/lib/db/connection";
import { cleanupTempDir, makeTempDir } from "@/lib/db/__tests__/test-db";
import { EMPTY_DB_PATH, POPULATED_DB_PATH } from "@/test/fixtures";
import type { SubagentNode, SubagentRootsRouteResponse } from "@/types/oc";
import { dynamic, GET } from "./route";

async function payload(response: Response): Promise<SubagentRootsRouteResponse> {
  return response.json() as Promise<SubagentRootsRouteResponse>;
}

function descendantCount(node: SubagentNode): number {
  return node.children.reduce((total, child) => total + 1 + descendantCount(child), 0);
}

describe("GET /api/sessions/tree", () => {
  let directory: string;
  let databasePath: string;
  let originalDb: string | undefined;
  let originalConfigHome: string | undefined;

  beforeEach(() => {
    directory = makeTempDir();
    databasePath = join(directory, "populated.db");
    copyFileSync(POPULATED_DB_PATH, databasePath);
    originalDb = process.env.OC_LENS_DB;
    originalConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.OC_LENS_DB = databasePath;
    process.env.XDG_CONFIG_HOME = join(directory, "config");
    resetConnectionForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetConnectionForTests();
    if (originalDb === undefined) delete process.env.OC_LENS_DB;
    else process.env.OC_LENS_DB = originalDb;
    if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalConfigHome;
    cleanupTempDir(directory);
  });

  it("returns all four spawning roots unpaginated and all eight fixture subagents", async () => {
    const response = await GET();
    const body = await payload(response);

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    if (!("data" in body)) throw new Error("expected subagent roots envelope");
    expect(body.data.map((root) => root.sessionId)).toEqual(["ses_0000", "ses_0003", "ses_0005", "ses_0007"]);
    expect(body.data.reduce((total, root) => total + descendantCount(root), 0)).toBe(8);
    expect(Object.fromEntries(body.data.map((root) => [root.sessionId, root.children.map((child) => child.sessionId)]))).toEqual({
      ses_0000: ["ses_0035", "ses_0036", "ses_0038"],
      ses_0003: ["ses_0037"],
      ses_0005: ["ses_0034", "ses_0039"],
      ses_0007: ["ses_0033", "ses_0040"],
    });
    expect(body.data.every((root) => root.cost.priced === false)).toBe(true);
  });

  it("chunks pricing-evidence lookups so a tree with more than one chunk of ids doesn't lose any warnings (code-review-2026-08-02.md M6)", async () => {
    const db = new DatabaseSync(databasePath);
    db.exec("INSERT INTO project (id, worktree, name) VALUES ('wide', '/wide', 'wide') ON CONFLICT(id) DO NOTHING;");
    db.exec("INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('ses_wide_root', 'wide', 'wide-root', '/wide', 'Wide root', '1', 1, 1);");
    const insertChild = db.prepare(
      "INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated) VALUES (?, 'wide', 'ses_wide_root', ?, '/wide', 'child', '1', 1, 1)",
    );
    const CHILD_COUNT = 850; // > the 800-per-chunk size, so at least 2 chunks are required
    for (let i = 0; i < CHILD_COUNT; i++) insertChild.run(`ses_wide_child_${i.toString().padStart(4, "0")}`, `wide-child-${i}`);
    // Deliberately malformed, on a child whose id only appears in the *second* chunk.
    db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('msg_wide_bad', 'ses_wide_child_0805', 1, 1, '{not json')").run();
    db.close();
    resetConnectionForTests();

    const response = await GET();
    const body = await payload(response);
    expect(response.status).toBe(200);
    if (!("data" in body)) throw new Error("expected subagent roots envelope");
    const wideRoot = body.data.find((root) => root.sessionId === "ses_wide_root");
    expect(wideRoot).toBeDefined();
    expect(descendantCount(wideRoot!)).toBe(CHILD_COUNT);
    expect(body.meta.warnings).toContainEqual(expect.objectContaining({ code: "malformed-message-data" }));
  });

  it("returns an exact empty list when no session spawned descendants", async () => {
    const empty = join(directory, "empty.db");
    copyFileSync(EMPTY_DB_PATH, empty);
    process.env.OC_LENS_DB = empty;
    resetConnectionForTests();
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await payload(response)).toMatchObject({ data: [], meta: { warnings: [] } });
  });

  it("surfaces malformed pricing evidence from returned trees without double-counting", async () => {
    const before = await payload(await GET());
    if (!("data" in before)) throw new Error("expected subagent roots envelope");
    const previousCount = before.meta.warnings.find((warning) => warning.code === "malformed-message-data")?.count ?? 0;
    resetConnectionForTests();
    const db = new DatabaseSync(databasePath);
    db.prepare("UPDATE message SET data = '{' WHERE id = (SELECT id FROM message WHERE session_id = 'ses_0035' LIMIT 1)").run();
    db.close();
    resetConnectionForTests();

    const body = await payload(await GET());

    if (!("data" in body)) throw new Error("expected subagent roots envelope");
    expect(body.meta.warnings.find((warning) => warning.code === "malformed-message-data")?.count).toBe(previousCount + 1);
  });

  it("returns sanitized database and schema states", async () => {
    const connection = vi.spyOn(connectionModule, "getConnection");
    connection.mockReturnValueOnce({ ok: false, reason: "not-found", searched: ["/private/missing.db"] });
    const missing = await GET();
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain("/private/missing.db");

    connection.mockReturnValueOnce({ ok: false, reason: "schema-mismatch", mismatch: { table: "session", missingColumns: ["parent_id"] } });
    const mismatch = await GET();
    expect(mismatch.status).toBe(409);
    expect(await payload(mismatch)).toMatchObject({ error: { code: "schema_mismatch" } });
  });
});
