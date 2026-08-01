import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSchema, schemaVersion } from "../schema-guard";
import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "./test-db";

describe("checkSchema", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    cleanupTempDir(dir);
  });

  it("passes on a fully-shaped database", () => {
    const dbPath = join(dir, "full.db");
    createFullSchemaDb(dbPath);
    const db = new DatabaseSync(dbPath, { readOnly: true });

    expect(checkSchema(db)).toBeNull();
    db.close();
  });

  it("returns a SchemaMismatch naming the missing column when session.tokens_input is dropped", () => {
    const dbPath = join(dir, "broken.db");
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(`
      CREATE TABLE project (
        id TEXT, worktree TEXT, vcs TEXT, name TEXT,
        time_created INTEGER, time_updated INTEGER, time_initialized INTEGER,
        sandboxes TEXT, commands TEXT
      );
      CREATE TABLE session (
        id TEXT, project_id TEXT, workspace_id TEXT, parent_id TEXT, slug TEXT,
        directory TEXT, path TEXT, title TEXT, version TEXT, share_url TEXT,
        summary_additions INTEGER, summary_deletions INTEGER, summary_files INTEGER,
        summary_diffs TEXT, metadata TEXT, cost REAL,
        tokens_output INTEGER, tokens_reasoning INTEGER, tokens_cache_read INTEGER, tokens_cache_write INTEGER,
        revert TEXT, permission TEXT, agent TEXT, model TEXT,
        time_created INTEGER, time_updated INTEGER, time_compacting INTEGER, time_archived INTEGER
      );
      CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
      CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
      CREATE TABLE todo (session_id TEXT, content TEXT, status TEXT, priority TEXT, position INTEGER, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE session_message (type TEXT, seq INTEGER, data TEXT);
    `);
    db.close();

    const ro = new DatabaseSync(dbPath, { readOnly: true });
    const mismatch = checkSchema(ro);

    expect(mismatch).not.toBeNull();
    expect(mismatch?.table).toBe("session");
    expect(mismatch?.missingColumns).toEqual(["tokens_input"]);
    ro.close();
  });

  it("returns a SchemaMismatch naming the whole column set when a table is missing entirely", () => {
    const dbPath = join(dir, "no-todo.db");
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(`
      CREATE TABLE project (
        id TEXT, worktree TEXT, vcs TEXT, name TEXT,
        time_created INTEGER, time_updated INTEGER, time_initialized INTEGER,
        sandboxes TEXT, commands TEXT
      );
      CREATE TABLE session (
        id TEXT, project_id TEXT, workspace_id TEXT, parent_id TEXT, slug TEXT,
        directory TEXT, path TEXT, title TEXT, version TEXT, share_url TEXT,
        summary_additions INTEGER, summary_deletions INTEGER, summary_files INTEGER,
        summary_diffs TEXT, metadata TEXT, cost REAL,
        tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER, tokens_cache_read INTEGER, tokens_cache_write INTEGER,
        revert TEXT, permission TEXT, agent TEXT, model TEXT,
        time_created INTEGER, time_updated INTEGER, time_compacting INTEGER, time_archived INTEGER
      );
      CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
      CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
      CREATE TABLE session_message (type TEXT, seq INTEGER, data TEXT);
    `);
    db.close();

    const ro = new DatabaseSync(dbPath, { readOnly: true });
    const mismatch = checkSchema(ro);

    expect(mismatch?.table).toBe("todo");
    ro.close();
  });

  it("exports the pinned schemaVersion", () => {
    expect(schemaVersion).toBe("opencode-1.17.7");
  });
});
