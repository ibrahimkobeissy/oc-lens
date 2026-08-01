import type { DatabaseSync } from "node:sqlite";

/** Test-only fixture kept under test/security so the production static scanner never needs an exception. */
export const FORBIDDEN_SERIALIZED_FIELD = '"access_token"';

export function addDenylistedSecretRows(db: DatabaseSync, firstSentinel: string, secondSentinel: string): void {
  db.exec("CREATE TABLE account (id TEXT, access_token TEXT); CREATE TABLE credential (id TEXT, value TEXT);");
  db.prepare("INSERT INTO account (id, access_token) VALUES (?, ?)").run("secret-row-1", firstSentinel);
  db.prepare("INSERT INTO credential (id, value) VALUES (?, ?)").run("secret-row-2", secondSentinel);
}
