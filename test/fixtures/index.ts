import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { buildFixtures } from "./build-fixture";
import { POPULATED_DB_PATH, EMPTY_DB_PATH } from "./paths";

export { POPULATED_DB_PATH, EMPTY_DB_PATH } from "./paths";
export * from "./manifest";

function ensureBuilt(): void {
  if (!existsSync(POPULATED_DB_PATH) || !existsSync(EMPTY_DB_PATH)) {
    buildFixtures();
  }
}

/** Hands `cb` a read-only connection to the populated fixture DB, building it on first use if needed. */
export function withFixture<T>(cb: (db: DatabaseSync) => T): T {
  ensureBuilt();
  const db = new DatabaseSync(POPULATED_DB_PATH, { readOnly: true });
  try {
    return cb(db);
  } finally {
    db.close();
  }
}

/** Hands `cb` a read-only connection to the empty fixture DB (schema present, zero rows in every table). */
export function withEmptyFixture<T>(cb: (db: DatabaseSync) => T): T {
  ensureBuilt();
  const db = new DatabaseSync(EMPTY_DB_PATH, { readOnly: true });
  try {
    return cb(db);
  } finally {
    db.close();
  }
}
