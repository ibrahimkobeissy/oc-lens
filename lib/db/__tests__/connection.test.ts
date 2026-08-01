import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openReadOnly, query, resetConnectionForTests, getConnection } from "../connection";
import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "./test-db";

describe("openReadOnly", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    cleanupTempDir(dir);
  });

  it("is provably read-only: a write statement fails", () => {
    const dbPath = join(dir, "ro.db");
    createFullSchemaDb(dbPath);

    const ro = openReadOnly(dbPath);
    expect(() => ro.exec("CREATE TABLE t(x)")).toThrow();
    ro.close();
  });

  it("reads successfully while a second connection holds an open WAL write transaction", () => {
    const dbPath = join(dir, "wal.db");
    createFullSchemaDb(dbPath);

    const writer = new DatabaseSync(dbPath);
    const ro = openReadOnly(dbPath);

    writer.exec("BEGIN IMMEDIATE");
    writer.exec("INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated) VALUES ('ses_1', 'x', 'pending', NULL, 0, 1, 1)");

    // The read-only connection must still be able to query while the writer's
    // transaction is open (WAL readers see the last-committed snapshot).
    const rows = query<{ id: string }>(ro, "SELECT id FROM session");
    expect(rows).toEqual([{ id: "ses_1" }]);

    writer.exec("COMMIT");
    writer.close();
    ro.close();
  });
});

describe("query", () => {
  let dir: string;
  let dbPath: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dir = makeTempDir();
    dbPath = join(dir, "denylist.db");
    createFullSchemaDb(dbPath);
    db = openReadOnly(dbPath);
  });

  afterEach(() => {
    db.close();
    cleanupTempDir(dir);
  });

  it.each(["account", "account_state", "control_account", "credential"])(
    "throws on SQL naming the denylisted table %s",
    (table) => {
      expect(() => query(db, `SELECT * FROM ${table}`)).toThrow(/denylisted/i);
    },
  );

  it("allows ordinary queries against non-denylisted tables", () => {
    const rows = query<{ id: string }>(db, "SELECT id FROM session WHERE id = ?", ["ses_1"]);
    expect(rows).toEqual([{ id: "ses_1" }]);
  });
});

describe("getConnection", () => {
  // Every case passes explicit locateOptions (a fully isolated temp env/homeDir,
  // never real process.env/homedir()) — this machine has a real opencode.db
  // under ~/.local/share/opencode, and getConnection()'s default locateDb()
  // fallback chain would otherwise find it, per the project rule to never
  // test against the developer's real DB.
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
    resetConnectionForTests();
  });

  afterEach(() => {
    resetConnectionForTests();
    cleanupTempDir(dir);
  });

  it("returns not-found with the searched paths when nothing resolves", () => {
    const result = getConnection({ env: { OC_LENS_DB: join(dir, "missing.db") }, homeDir: join(dir, "empty-home") });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not-found");
    }
  });

  it("returns schema-mismatch naming the missing column on a deficient DB", () => {
    const dbPath = join(dir, "broken.db");
    const db2 = new DatabaseSync(dbPath);
    db2.exec("PRAGMA journal_mode = WAL;");
    db2.exec("CREATE TABLE project (id TEXT)");
    db2.close();

    const result = getConnection({ env: { OC_LENS_DB: dbPath }, homeDir: join(dir, "empty-home") });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "schema-mismatch") {
      expect(result.mismatch.table).toBe("project");
      expect(result.mismatch.missingColumns).toContain("worktree");
    } else {
      throw new Error(`expected schema-mismatch, got ${JSON.stringify(result)}`);
    }
  });

  it("caches the connection across calls", () => {
    const dbPath = join(dir, "cached.db");
    createFullSchemaDb(dbPath);

    const first = getConnection({ env: { OC_LENS_DB: dbPath }, homeDir: join(dir, "empty-home") });
    const second = getConnection({ env: { OC_LENS_DB: dbPath }, homeDir: join(dir, "empty-home") });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.db).toBe(second.db);
    }
  });
});
