import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as connectionModule from "@/lib/db/connection";
import { resetConnectionForTests } from "@/lib/db/connection";
import { cleanupTempDir, makeTempDir } from "@/lib/db/__tests__/test-db";
import { POPULATED_DB_PATH } from "@/test/fixtures";
import type { ProjectsRouteResponse } from "@/types/oc";

import { dynamic, GET } from "./route";

describe("GET /api/projects", () => {
  let directory: string;
  let originalDb: string | undefined;

  beforeEach(() => {
    directory = makeTempDir();
    const database = join(directory, "opencode.db");
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

  it("returns ordered project aggregates and the documented global display-name fallback", async () => {
    const response = await GET();
    const payload = await response.json() as ProjectsRouteResponse;

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    if (!("data" in payload)) throw new Error("expected projects envelope");
    expect(payload.data.map((project) => project.id)).toEqual(
      [...payload.data.map((project) => project.id)].sort(),
    );
    expect(payload.data.find((project) => project.id === "global")?.displayName).toBe("global");
    expect(payload.data.every((project) => project.cost.priced === false)).toBe(true);
    expect(payload.meta.schemaVersion).toBe("opencode-1.17.7");
  });

  it("returns explicit database and schema states", async () => {
    const connection = vi.spyOn(connectionModule, "getConnection");
    connection.mockReturnValueOnce({ ok: false, reason: "not-found", searched: ["/missing/opencode.db"] });
    const missing = await GET();
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "database_not_found" } });

    connection.mockReturnValueOnce({
      ok: false,
      reason: "schema-mismatch",
      mismatch: { table: "session", missingColumns: ["tokens_input"] },
    });
    const mismatch = await GET();
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toMatchObject({ error: { code: "schema_mismatch" } });
  });
});
