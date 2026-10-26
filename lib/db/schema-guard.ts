import type { DatabaseSync } from "node:sqlite";
import { SESSION_COLUMNS } from "./canonical";
import { isDenylistedTable } from "./denylist";

/**
 * The opencode schemas oc-lens is verified against — project-docs/opencode-data-model.md
 * §0 (1.x, `session`/`message`/`part`) and §8 (2.x, `session_v2`/`session_message`).
 * A database upgraded from 1.x carries both and is read as one history.
 */
export const schemaVersion = "opencode-1.17.7+2.1.4";

export interface SchemaMismatch {
  table: string;
  missingColumns: string[];
}

interface ExpectedTable {
  table: string;
  columns: string[];
}

// Column lists are exactly what project-docs/opencode-data-model.md documents
// as verified for each table oc-lens reads (§1, §2, §3, §8) — nothing invented
// beyond what's been observed. `message`/`part`/`session_message` carry their
// real payload in the `data` JSON column, so only the envelope columns are
// checked here; OCL-012's decoders are responsible for the JSON shape itself.
const PROJECT_TABLE: ExpectedTable = {
    table: "project",
    columns: [
      "id",
      "worktree",
      "vcs",
      "name",
      "time_created",
      "time_updated",
      "time_initialized",
      "sandboxes",
      "commands",
    ],
};

const V1_TABLES: ExpectedTable[] = [
  {
    table: "session",
    columns: [
      "id",
      "project_id",
      "workspace_id",
      "parent_id",
      "slug",
      "directory",
      "path",
      "title",
      "version",
      "share_url",
      "summary_additions",
      "summary_deletions",
      "summary_files",
      "summary_diffs",
      "metadata",
      "cost",
      "tokens_input",
      "tokens_output",
      "tokens_reasoning",
      "tokens_cache_read",
      "tokens_cache_write",
      "revert",
      "permission",
      "agent",
      "model",
      "time_created",
      "time_updated",
      "time_compacting",
      "time_archived",
    ],
  },
  { table: "message", columns: ["id", "session_id", "time_created", "time_updated", "data"] },
  { table: "part", columns: ["id", "message_id", "session_id", "time_created", "time_updated", "data"] },
  {
    table: "todo",
    columns: ["session_id", "content", "status", "priority", "position", "time_created", "time_updated"],
  },
  { table: "session_message", columns: ["type", "seq", "data"] },
];

// opencode 2.x: `session_v2` must still carry every legacy session column the
// canonical `session` view re-exposes (lib/db/canonical.ts), and
// `session_message` is the whole transcript, so its full envelope is required.
const V2_TABLES: ExpectedTable[] = [
  { table: "session_v2", columns: [...SESSION_COLUMNS] },
  { table: "session_message", columns: ["id", "session_id", "type", "seq", "time_created", "time_updated", "data"] },
];

interface TableInfoRow {
  name: string;
}

// `table` always comes from our own hardcoded table lists above,
// never user input — this guard is defense-in-depth, not the primary check,
// so a future edit that threads a dynamic table name through checkSchema
// can't silently bypass the same denylist every other query path enforces
// (lib/db/connection.ts's `query()`, backed by lib/db/denylist.ts).
function assertNotDenylisted(table: string): void {
  if (isDenylistedTable(table)) {
    throw new Error(`Refusing to check schema for denylisted table "${table}"`);
  }
}

function tableExists(db: DatabaseSync, table: string): boolean {
  assertNotDenylisted(table);
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return row !== undefined;
}

function actualColumns(db: DatabaseSync, table: string): Set<string> {
  assertNotDenylisted(table);
  // PRAGMA doesn't accept bound parameters for the table name.
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as TableInfoRow[];
  return new Set(rows.map((row) => row.name));
}

function firstMismatch(db: DatabaseSync, tables: readonly ExpectedTable[]): SchemaMismatch | null {
  for (const expected of tables) {
    if (!tableExists(db, expected.table)) {
      return { table: expected.table, missingColumns: expected.columns };
    }

    const present = actualColumns(db, expected.table);
    const missingColumns = expected.columns.filter((col) => !present.has(col));
    if (missingColumns.length > 0) {
      return { table: expected.table, missingColumns };
    }
  }
  return null;
}

/**
 * Reads `sqlite_master` (and each table's `PRAGMA table_info`) and asserts the
 * tables/columns oc-lens's query modules depend on. The generation is chosen by
 * the spine table: `session_v2` means opencode 2.x, and a legacy `session`
 * table beside it means an upgraded (mixed) database whose 1.x tables must
 * still be intact — a half-present legacy schema is a mismatch, never a
 * silent partial read. Returns a structured `SchemaMismatch` naming exactly
 * what differs on the first mismatch found — never silently degrades, never
 * returns null for an actual mismatch.
 */
export function checkSchema(db: DatabaseSync): SchemaMismatch | null {
  const hasV2 = tableExists(db, "session_v2");
  const hasLegacy = tableExists(db, "session");
  const tables = [PROJECT_TABLE, ...(hasV2 ? V2_TABLES : []), ...(hasLegacy || !hasV2 ? V1_TABLES : [])];
  return firstMismatch(db, tables);
}
