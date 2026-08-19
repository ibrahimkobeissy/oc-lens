import { DatabaseSync } from "node:sqlite";
import { findDenylistedTable } from "./denylist";
import { locateDb, type LocateOptions } from "./locate";
import { checkSchema, type SchemaMismatch } from "./schema-guard";

export type SqlParam = string | number | bigint | null;

export type ConnectResult =
  | { ok: true; db: DatabaseSync }
  | { ok: false; reason: "not-found"; searched: string[] }
  | { ok: false; reason: "schema-mismatch"; mismatch: SchemaMismatch };

let cached: DatabaseSync | null = null;

/** Opens `path` read-only. No caching — a plain constructor wrapper, exposed separately from `getConnection` so tests can open independent connections to the same file (e.g. to exercise concurrent WAL access). */
export function openReadOnly(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true });
}

/**
 * The process-wide cached read-only connection: locates the DB, opens it
 * read-only, and runs the schema guard before caching. Returns a discriminated
 * result rather than throwing for "not found" or "schema mismatch" — callers
 * must render an honest state for both, never guess.
 *
 * `locateOptions` forwards to `locateDb` (env/homeDir overrides) — production
 * callers omit it; tests use it to fully isolate from this machine's real
 * `~/.local/share/opencode/opencode.db`, per the project rule to never test
 * against the developer's real DB.
 */
export function getConnection(locateOptions?: LocateOptions): ConnectResult {
  if (cached) {
    return { ok: true, db: cached };
  }

  const located = locateDb(locateOptions);
  if (!located.found) {
    return { ok: false, reason: "not-found", searched: located.searched };
  }

  const db = openReadOnly(located.path);

  const mismatch = checkSchema(db);
  if (mismatch) {
    db.close();
    return { ok: false, reason: "schema-mismatch", mismatch };
  }

  cached = db;
  return { ok: true, db };
}

/** Test-only: drops the cached connection so the next `getConnection()` call re-locates and re-opens. */
export function resetConnectionForTests(): void {
  cached?.close();
  cached = null;
}

/**
 * The only sanctioned way to run a query against the opencode connection.
 * Rejects any SQL naming a denylisted table before it ever reaches SQLite.
 * The cast at `stmt.all(...)` is the documented decoder boundary between the
 * driver's loosely-typed row shape and our typed query-module return values.
 */
export function query<T>(db: DatabaseSync, sql: string, params: readonly SqlParam[] = []): T[] {
  const denylisted = findDenylistedTable(sql);
  if (denylisted) {
    throw new Error(`Refusing to run SQL referencing the denylisted table "${denylisted}"`);
  }
  const stmt = db.prepare(sql);
  return stmt.all(...params) as unknown as T[];
}
