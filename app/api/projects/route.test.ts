import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as connectionModule from "@/lib/db/connection";
import { resetConnectionForTests } from "@/lib/db/connection";
import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";
import { writePricing } from "@/lib/pricing/config";
import { POPULATED_DB_PATH } from "@/test/fixtures";
import type { ProjectsRouteResponse } from "@/types/oc";

import { dynamic, GET } from "./route";

describe("GET /api/projects", () => {
  let directory: string;
  let originalDb: string | undefined;
  let originalConfigHome: string | undefined;

  beforeEach(() => {
    directory = makeTempDir();
    const database = join(directory, "opencode.db");
    copyFileSync(POPULATED_DB_PATH, database);
    originalDb = process.env.OC_LENS_DB;
    originalConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.OC_LENS_DB = database;
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

  it("flows configured pricing into project cost values", async () => {
    const pricedDatabase = join(directory, "priced.db");
    createFullSchemaDb(pricedDatabase);
    const writable = new DatabaseSync(pricedDatabase);
    writable.prepare("UPDATE message SET data = ? WHERE id = 'msg_1'").run(JSON.stringify({ role: "assistant", providerID: "provider", modelID: "model", tokens: { input: 1_000_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }));
    writable.close();
    process.env.OC_LENS_DB = pricedDatabase;
    resetConnectionForTests();
    writePricing({
      version: 1,
      updatedAt: 1,
      prices: { "provider/model": { inputPerMTok: 1, outputPerMTok: 1, cacheReadPerMTok: 1, cacheWritePerMTok: 1, currency: "USD" as const } },
    }, { configHome: process.env.XDG_CONFIG_HOME });
    const payload = await (await GET()).json() as ProjectsRouteResponse;
    if (!("data" in payload)) throw new Error("expected projects envelope");
    expect(payload.data.find((project) => project.id === "global")?.cost).toEqual({ amount: 1, priced: true });
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
