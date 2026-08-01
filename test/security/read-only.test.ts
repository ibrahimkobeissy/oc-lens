import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openReadOnly } from "../../lib/db/connection";
import { cleanupTempDir, createFullSchemaDb, makeTempDir } from "../../lib/db/__tests__/test-db";

/**
 * OCL-011 already proves `CREATE TABLE` fails against the read-only
 * connection. This extends coverage to every other write statement, so the
 * read-only guarantee (project-docs/opencode-data-model.md §6) is executable
 * across the whole surface, not just one statement type.
 */
describe("read-only connection rejects every write statement", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = makeTempDir();
    dbPath = join(dir, "ro.db");
    createFullSchemaDb(dbPath);
  });

  afterEach(() => {
    cleanupTempDir(dir);
  });

  it.each([
    [
      "INSERT",
      "INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated) VALUES ('x','y','pending',NULL,0,1,1)",
    ],
    ["UPDATE", "UPDATE session SET title = 'x' WHERE id = 'ses_1'"],
    ["DELETE", "DELETE FROM session WHERE id = 'ses_1'"],
    ["DROP", "DROP TABLE session"],
    ["PRAGMA journal_mode=", "PRAGMA journal_mode=DELETE"],
  ])("%s fails against the read-only connection", (_label, sql) => {
    const ro = openReadOnly(dbPath);
    expect(() => ro.exec(sql)).toThrow();
    ro.close();
  });
});
