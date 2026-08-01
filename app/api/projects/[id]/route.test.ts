import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as connectionModule from "@/lib/db/connection";
import { resetConnectionForTests } from "@/lib/db/connection";
import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";
import { POPULATED_DB_PATH } from "@/test/fixtures";
import type { ProjectRouteResponse } from "@/types/oc";

import { dynamic, GET } from "./route";

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/projects/[id]", () => {
  let directory: string;
  let database: string;
  let originalDb: string | undefined;

  beforeEach(() => {
    directory = makeTempDir();
    database = join(directory, "opencode.db");
    copyFileSync(POPULATED_DB_PATH, database);
    originalDb = process.env.OC_LENS_DB;
    process.env.OC_LENS_DB = database;
    resetConnectionForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetConnectionForTests();
    if (originalDb === undefined) delete process.env.OC_LENS_DB;
    else process.env.OC_LENS_DB = originalDb;
    cleanupTempDir(directory);
  });

  it("returns project-scoped sessions and activity while omitting branches for an empty workspace", async () => {
    const response = await GET(new Request("http://localhost/api/projects/proj_infra"), context("proj_infra"));
    const payload = await response.json() as ProjectRouteResponse;

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    if (!("data" in payload)) throw new Error("expected project envelope");
    expect(payload.data.id).toBe("proj_infra");
    expect(payload.data.sessions).not.toHaveLength(0);
    expect(payload.data.sessions.every((session) => session.projectId === "proj_infra")).toBe(true);
    expect(payload.data.dailyActivity.reduce((sum, day) => sum + day.sessionCount, 0)).toBe(payload.data.sessionCount);
    expect(payload.data).not.toHaveProperty("branches");
  });

  it("exposes sorted unique branches when workspace rows exist for the project", async () => {
    const writable = new DatabaseSync(database);
    writable.prepare("INSERT INTO workspace (id, project_id, branch, directory, type) VALUES (?, ?, ?, ?, ?)")
      .run("ws-2", "proj_infra", "feature/zeta", "/workspace/infra", "local");
    writable.prepare("INSERT INTO workspace (id, project_id, branch, directory, type) VALUES (?, ?, ?, ?, ?)")
      .run("ws-1", "proj_infra", "main", "/workspace/infra", "local");
    writable.prepare("INSERT INTO workspace (id, project_id, branch, directory, type) VALUES (?, ?, ?, ?, ?)")
      .run("ws-3", "proj_infra", "main", "/workspace/infra-2", "local");
    writable.close();

    const response = await GET(new Request("http://localhost/api/projects/proj_infra"), context("proj_infra"));
    const payload = await response.json() as ProjectRouteResponse;
    if (!("data" in payload)) throw new Error("expected project envelope");
    expect(payload.data.branches).toEqual(["feature/zeta", "main"]);
  });

  it("omits branches when the optional workspace table is absent", async () => {
    const withoutWorkspace = join(directory, "without-workspace.db");
    createFullSchemaDb(withoutWorkspace);
    process.env.OC_LENS_DB = withoutWorkspace;
    resetConnectionForTests();

    const response = await GET(new Request("http://localhost/api/projects/global"), context("global"));
    const payload = await response.json() as ProjectRouteResponse;

    expect(response.status).toBe(200);
    if (!("data" in payload)) throw new Error("expected project envelope");
    expect(payload.data).not.toHaveProperty("branches");
  });

  it("returns a 404 envelope for an unknown project and rejects an empty id", async () => {
    const missing = await GET(new Request("http://localhost/api/projects/missing"), context("missing"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: { code: "project_not_found", message: "Project missing was not found." },
    });

    const invalid = await GET(new Request("http://localhost/api/projects/invalid"), context(""));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_project_id" } });
  });

  it("returns explicit database and schema states", async () => {
    const connection = vi.spyOn(connectionModule, "getConnection");
    connection.mockReturnValueOnce({ ok: false, reason: "not-found", searched: ["/missing/opencode.db"] });
    const missing = await GET(new Request("http://localhost/api/projects/global"), context("global"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "database_not_found" } });

    connection.mockReturnValueOnce({
      ok: false,
      reason: "schema-mismatch",
      mismatch: { table: "session", missingColumns: ["tokens_input"] },
    });
    const mismatch = await GET(new Request("http://localhost/api/projects/global"), context("global"));
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toMatchObject({ error: { code: "schema_mismatch" } });
  });
});
