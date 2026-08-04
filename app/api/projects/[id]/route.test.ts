import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as connectionModule from "@/lib/db/connection";
import { resetConnectionForTests } from "@/lib/db/connection";
import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";
import { writePricing } from "@/lib/pricing/config";
import { POPULATED_DB_PATH } from "@/test/fixtures";
import type { PricingConfig, ProjectRouteResponse } from "@/types/oc";

import { dynamic, GET } from "./route";

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/projects/[id]", () => {
  let directory: string;
  let database: string;
  let originalDb: string | undefined;
  let originalConfigHome: string | undefined;

  beforeEach(() => {
    directory = makeTempDir();
    database = join(directory, "opencode.db");
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
    expect(payload.data.modelBreakdown.reduce((sum, model) => sum + model.messageCount, 0)).toBe(payload.data.messageCount);
    expect(payload.data).not.toHaveProperty("branches");
  });

  it("composes message-level model switches and fully, partially, and wholly unpriced project costs", async () => {
    const switchingDatabase = join(directory, "switching.db");
    createFullSchemaDb(switchingDatabase);
    const writable = new DatabaseSync(switchingDatabase);
    writable.prepare("UPDATE session SET model = ? WHERE id = 'ses_1'").run(JSON.stringify({ id: "wrong-session-model", providerID: "session-provider", variant: "default" }));
    writable.prepare("UPDATE message SET data = ? WHERE id = 'msg_1'").run(JSON.stringify({ role: "assistant", providerID: "provider-a", modelID: "model-a", tokens: { input: 1_000_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 1, completed: 2 } }));
    const insert = writable.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, 'ses_1', ?, ?, ?)");
    insert.run("msg-switch", 2, 2, JSON.stringify({ role: "assistant", providerID: "provider-b", modelID: "model-b", tokens: { input: 0, output: 500_000, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 2, completed: 3 } }));
    insert.run("msg-unknown", 3, 3, JSON.stringify({ role: "user", time: { created: 3 } }));
    writable.close();
    process.env.OC_LENS_DB = switchingDatabase;
    resetConnectionForTests();

    const partial: PricingConfig = {
      version: 1,
      updatedAt: 1,
      prices: {
        "provider-a/model-a": { inputPerMTok: 2, outputPerMTok: 0, cacheReadPerMTok: 0, cacheWritePerMTok: 0, currency: "USD" },
      },
    };
    writePricing(partial, { configHome: process.env.XDG_CONFIG_HOME });
    let response = await GET(new Request("http://localhost/api/projects/global"), context("global"));
    let payload = await response.json() as ProjectRouteResponse;
    if (!("data" in payload)) throw new Error("expected project envelope");
    expect(payload.data.cost).toEqual({ amount: 0, priced: false });
    expect(payload.data.modelBreakdown.map((model) => `${model.providerID}/${model.modelID}`)).toEqual(["provider-a/model-a", "provider-b/model-b", "unknown/unknown"]);
    expect(payload.data.modelBreakdown.some((model) => model.modelID === "wrong-session-model")).toBe(false);

    writePricing({
      ...partial,
      prices: {
        ...partial.prices,
        "provider-b/model-b": { inputPerMTok: 0, outputPerMTok: 4, cacheReadPerMTok: 0, cacheWritePerMTok: 0, currency: "USD" },
      },
    }, { configHome: process.env.XDG_CONFIG_HOME });
    response = await GET(new Request("http://localhost/api/projects/global"), context("global"));
    payload = await response.json() as ProjectRouteResponse;
    if (!("data" in payload)) throw new Error("expected project envelope");
    expect(payload.data.cost.priced).toBe(true);
    expect(payload.data.cost.amount).toBeCloseTo(4, 9);
    expect(payload.data.sessions).toHaveLength(1);
    expect(payload.data.sessions[0]?.cost).toEqual({ amount: 4, priced: true });

    writePricing({ version: 1, updatedAt: 3, prices: {} }, { configHome: process.env.XDG_CONFIG_HOME });
    response = await GET(new Request("http://localhost/api/projects/global"), context("global"));
    payload = await response.json() as ProjectRouteResponse;
    if (!("data" in payload)) throw new Error("expected project envelope");
    expect(payload.data.cost).toEqual({ amount: 0, priced: false });
  });

  it("validates IANA timezones and applies them to project activity days", async () => {
    const invalid = await GET(new Request("http://localhost/api/projects/proj_infra?tz=Not/A_Zone"), context("proj_infra"));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_timezone" } });

    const boundaryDatabase = join(directory, "timezone.db");
    createFullSchemaDb(boundaryDatabase);
    const writable = new DatabaseSync(boundaryDatabase);
    const boundary = Date.UTC(2026, 7, 2, 1);
    writable.prepare("UPDATE session SET time_created = ?, time_updated = ? WHERE id = 'ses_1'").run(boundary, boundary + 1);
    writable.prepare("UPDATE message SET time_created = ?, time_updated = ? WHERE id = 'msg_1'").run(boundary, boundary);
    writable.prepare("UPDATE part SET time_created = ?, time_updated = ? WHERE id = 'prt_1'").run(boundary, boundary);
    writable.close();
    process.env.OC_LENS_DB = boundaryDatabase;
    resetConnectionForTests();

    const utc = await GET(new Request("http://localhost/api/projects/global?tz=UTC"), context("global"));
    const utcPayload = await utc.json() as ProjectRouteResponse;
    const losAngeles = await GET(new Request("http://localhost/api/projects/global?tz=America%2FLos_Angeles"), context("global"));
    const losAngelesPayload = await losAngeles.json() as ProjectRouteResponse;
    if (!("data" in utcPayload) || !("data" in losAngelesPayload)) throw new Error("expected project envelopes");

    expect(utcPayload.data.dailyActivity.map((day) => day.date)).toEqual(["2026-08-02"]);
    expect(losAngelesPayload.data.dailyActivity.map((day) => day.date)).toEqual(["2026-08-01"]);
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
