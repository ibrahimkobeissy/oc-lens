import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConnectionForTests } from "@/lib/db/connection";
import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "@/lib/db/__tests__/test-db";

describe("GET /api/settings", () => {
  let dir: string;
  let originalDb: string | undefined;
  let originalConfigHome: string | undefined;

  beforeEach(() => {
    dir = makeTempDir();
    originalDb = process.env.OC_LENS_DB;
    originalConfigHome = process.env.XDG_CONFIG_HOME;
    const isolatedDb = join(dir, "isolated.db");
    createFullSchemaDb(isolatedDb);
    process.env.OC_LENS_DB = isolatedDb;
    process.env.XDG_CONFIG_HOME = join(dir, "config-home");
    resetConnectionForTests();
  });

  afterEach(() => {
    resetConnectionForTests();
    if (originalDb === undefined) delete process.env.OC_LENS_DB;
    else process.env.OC_LENS_DB = originalDb;
    if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalConfigHome;
    cleanupTempDir(dir);
  });

  it("returns a clean null config when no config exists", async () => {
    const { dynamic, GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(dynamic).toBe("force-dynamic");
    expect(body.data).toMatchObject({
      dbPath: join(dir, "isolated.db"),
      opencodeVersion: "1.17.7",
      config: null,
    });
    expect(body.data.storage.dbBytes).toBeGreaterThan(0);
  });

  it("keeps the missing-database diagnostic available as a successful Settings response", async () => {
    process.env.OC_LENS_DB = join(dir, "missing.db");
    resetConnectionForTests();
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { dbPath: null, opencodeVersion: null } });
  });

  it("returns version, project config, storage, and only redacted config values", async () => {
    const dbPath = join(dir, "opencode.db");
    const project = join(dir, "project");
    createFullSchemaDb(dbPath);
    const writableDb = new DatabaseSync(dbPath);
    writableDb
      .prepare(
        "INSERT INTO project (id, worktree, vcs, name, time_created, time_updated, time_initialized, sandboxes, commands) VALUES (?, ?, NULL, ?, 1, 1, NULL, '[]', NULL)",
      )
      .run("project-1", project, "project");
    writableDb.close();
    mkdirSync(project, { recursive: true });
    writeFileSync(
      join(project, "opencode.jsonc"),
      '{"agent":{"build":{"mode":"primary","apiKey":"sk-project"}},"mcp":{"docs":{"type":"remote","headers":{"Authorization":"secret"}}}}',
    );
    process.env.OC_LENS_DB = dbPath;

    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(body.data.dbPath).toBe(dbPath);
    expect(body.data.opencodeVersion).toBe("1.17.7");
    expect(body.data.storage.dbBytes).toBeGreaterThan(0);
    expect(body.data.config.agents).toEqual(["build"]);
    expect(body.data.config.mcpServers).toEqual([{ name: "docs", transport: "remote" }]);
    expect(JSON.stringify(body)).not.toContain("sk-project");
    expect(JSON.stringify(body)).not.toContain('"secret"');
    expect(body.data.config.raw.agent.build.apiKey).toBe("[redacted]");
  });

  it("returns the standard schema_mismatch envelope instead of a successful diagnostic payload", async () => {
    const mismatchPath = join(dir, "schema-mismatch.db");
    const mismatchDb = new DatabaseSync(mismatchPath);
    mismatchDb.exec("CREATE TABLE session (id TEXT PRIMARY KEY)");
    mismatchDb.close();
    process.env.OC_LENS_DB = mismatchPath;
    resetConnectionForTests();

    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "schema_mismatch",
        message: "The opencode database schema is not supported by opencode-1.17.7.",
      },
    });
  });
});
