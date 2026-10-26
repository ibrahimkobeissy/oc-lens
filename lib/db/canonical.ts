import type { DatabaseSync } from "node:sqlite";

/**
 * The canonical read layer for opencode 1.x, 2.x, and mixed databases.
 *
 * opencode 1.x keeps a session's transcript in `session` / `message` / `part`
 * (+ `todo`). opencode 2.x replaces all four with `session_v2` and an
 * event-style `session_message` transcript (data-model §8). Upgrading a 1.x
 * install copies every legacy session into `session_v2` and every legacy
 * message into `session_message` under the **same ids**, and leaves the legacy
 * tables in place — so a real upgraded database holds both generations.
 *
 * Rather than teach every query module two schemas, this installs per-connection
 * TEMP views named `session`, `message`, `part`, and `todo`. SQLite resolves an
 * unqualified table name against the `temp` schema before `main`, so every
 * existing query reads the merged, v1-shaped rows without being rewritten.
 * The 2.x projection behind them is cached in in-memory TEMP tables and rebuilt
 * whenever opencode commits (`refresh`). TEMP objects live only in this
 * connection's private temp schema: nothing is written to opencode.db, and the
 * connection stays `readOnly: true` (D2).
 *
 * Deduplication rules (verified against a real upgraded database, data-model §8):
 *
 * - **session** — `session_v2` is the spine whenever it exists; a legacy-only
 *   session row (a database caught mid-migration) is added only when its id is
 *   absent from `session_v2`.
 * - **message / part** — a session's legacy rows win. A `session_message` row is
 *   projected only if its id is not a legacy message id **and** either the
 *   session has no legacy messages at all, or the row is newer than the
 *   session's last legacy message (a 1.x session continued under 2.x). This
 *   keeps the rows the 2.x migration synthesised inside legacy sessions out of
 *   v1 analytics.
 * - **todo** — the legacy `todo` table wins per session. opencode 2.x has no
 *   `todo` table; for 2.x sessions the list is derived from the session's last
 *   completed `todowrite` call.
 *
 * Lifecycle records (`system`, `idle`, `agent-switched`, …) are not messages and
 * are not projected into `message` — they would inflate message counts that
 * mean "user/assistant turns" in 1.x. Replay reads them separately through the
 * `oc_session_event` view (see `listSessionEvents`).
 */

export type DbGeneration = "v1" | "v2" | "mixed";

/** Legacy `session` columns every query module may select — exactly schema-guard's verified v1 list. */
export const SESSION_COLUMNS = [
  "id", "project_id", "workspace_id", "parent_id", "slug", "directory", "path", "title", "version", "share_url",
  "summary_additions", "summary_deletions", "summary_files", "summary_diffs", "metadata", "cost",
  "tokens_input", "tokens_output", "tokens_reasoning", "tokens_cache_read", "tokens_cache_write",
  "revert", "permission", "agent", "model", "time_created", "time_updated", "time_compacting", "time_archived",
] as const;

function tableExists(db: DatabaseSync, schema: "main" | "temp", table: string): boolean {
  const master = schema === "main" ? "main.sqlite_master" : "sqlite_temp_master";
  return db.prepare(`SELECT 1 FROM ${master} WHERE type IN ('table', 'view') AND name = ?`).get(table) !== undefined;
}

/** Which generation of opencode schema the open database carries, judged by its spine tables. */
export function detectGeneration(db: DatabaseSync): DbGeneration {
  const v2 = tableExists(db, "main", "session_v2");
  if (!v2) return "v1";
  return tableExists(db, "main", "session") ? "mixed" : "v2";
}

// `session_v2.title` is nullable where 1.x's `session.title` never was. A NULL
// title is rewritten to opencode's own placeholder form so it takes the same,
// already-tested fallback (first user text, then slug) as a 1.x placeholder.
const V2_SESSION_SELECT = `SELECT ${SESSION_COLUMNS.map((column) => column === "title"
  ? "COALESCE(title, 'New session - ' || strftime('%Y-%m-%dT%H:%M:%fZ', time_created / 1000.0, 'unixepoch')) AS title"
  : column).join(", ")} FROM main.session_v2`;

function v2RowsSql(generation: Exclude<DbGeneration, "v1">): string {
  const base = "SELECT sm.id, sm.session_id, sm.type, sm.seq, sm.time_created, sm.time_updated, sm.data FROM main.session_message sm";
  if (generation === "v2") return base;
  return `${base}
    WHERE NOT EXISTS (SELECT 1 FROM main.message lm WHERE lm.id = sm.id)
      AND (NOT EXISTS (SELECT 1 FROM main.message lm WHERE lm.session_id = sm.session_id)
        OR sm.time_created > (SELECT MAX(lm.time_created) FROM main.message lm WHERE lm.session_id = sm.session_id))`;
}

// One `session_message` row becomes one v1-shaped message. Upstream's stored
// data omits `type` and `id` (they are columns). `json_patch('{}', …)` drops
// members whose value is NULL, so absent v2 fields stay absent rather than
// turning into a JSON `null` the decoders would flag as malformed.
const V2_MESSAGE_SQL = `
SELECT r.id, r.session_id, r.time_created, r.time_updated,
  json_patch('{}', json_object(
    'role', 'user',
    'time', json_object('created', COALESCE(r.data ->> '$.time.created', r.time_created)),
    -- v2 user rows record no agent; the agent that answered the prompt is the honest stand-in.
    'agent', (SELECT a.data ->> '$.agent' FROM main.session_message a
               WHERE a.session_id = r.session_id AND a.type = 'assistant' AND a.seq > r.seq ORDER BY a.seq LIMIT 1)
  )) AS data
FROM oc_lens_v2_rows r WHERE r.type IN ('user', 'synthetic', 'compaction')
UNION ALL
SELECT r.id, r.session_id, r.time_created, r.time_updated,
  json_patch('{}', json_object(
    'role', 'assistant',
    'parentID', (SELECT u.id FROM main.session_message u
                  WHERE u.session_id = r.session_id AND u.type IN ('user', 'synthetic', 'compaction') AND u.seq < r.seq ORDER BY u.seq DESC LIMIT 1),
    'agent', r.data ->> '$.agent',
    'mode', r.data ->> '$.agent',
    'modelID', r.data ->> '$.model.id',
    'providerID', r.data ->> '$.model.providerID',
    'cost', r.data ->> '$.cost',
    'tokens', r.data -> '$.tokens',
    'time', json_object('created', COALESCE(r.data ->> '$.time.created', r.time_created), 'completed', r.data ->> '$.time.completed'),
    'finish', r.data ->> '$.finish',
    'error', r.data -> '$.error',
    -- A step that failed at the provider or is still streaming records no tokens.
    -- Marked so pricing reads it as "nothing reported", not as broken evidence.
    'usage', CASE WHEN r.data -> '$.tokens' IS NULL THEN 'none' END
  )) AS data
FROM oc_lens_v2_rows r WHERE r.type = 'assistant'
UNION ALL
-- A v2 compaction row carries the summary and the usage of the compaction
-- request itself. 1.x recorded both on a separate assistant message after the
-- compaction marker; this restores that pair so the usage is not dropped.
SELECT r.id || '-summary', r.session_id, r.time_created, r.time_updated,
  json_patch('{}', json_object(
    'role', 'assistant',
    'parentID', r.id,
    'agent', 'compaction',
    'mode', 'compaction',
    'modelID', r.data ->> '$.model.id',
    'providerID', r.data ->> '$.model.providerID',
    'cost', r.data ->> '$.cost',
    'tokens', r.data -> '$.tokens',
    'time', json_object('created', COALESCE(r.data ->> '$.time.created', r.time_created)),
    'usage', CASE WHEN r.data -> '$.tokens' IS NULL THEN 'none' END
  )) AS data
FROM oc_lens_v2_rows r
WHERE r.type = 'compaction' AND (COALESCE(r.data ->> '$.summary', '') <> '' OR r.data -> '$.tokens' IS NOT NULL OR r.data ->> '$.cost' IS NOT NULL)`;

// Part ids sort in transcript order under the existing `ORDER BY time_created, id`:
// every part of a message shares its time, and `.0` (step-start) < `.1-NNNNNN`
// (content, in array order) < `.1-patch` (snapshot diff) < `.2` (step-finish).
const V2_PART_SQL = `
SELECT r.id || '.0' AS id, r.id AS message_id, r.session_id, r.time_created, r.time_updated, '{"type":"step-start"}' AS data
FROM oc_lens_v2_rows r WHERE r.type = 'assistant'
UNION ALL
SELECT r.id || '.1-' || printf('%06d', c.key), r.id, r.session_id, r.time_created, r.time_updated,
  CASE c.value ->> '$.type'
    WHEN 'text' THEN json_object('type', 'text', 'text', c.value ->> '$.text')
    WHEN 'reasoning' THEN json_patch('{}', json_object('type', 'reasoning', 'text', c.value ->> '$.text',
      'time', json_object('start', c.value ->> '$.time.created', 'end', c.value ->> '$.time.completed')))
    -- Not json_patch: a tool's input/metadata must reach the loop signature byte-for-byte, nulls included.
    WHEN 'tool' THEN json_object('type', 'tool', 'tool', c.value ->> '$.name', 'callID', c.value ->> '$.id',
      'state', json_object(
        'status', CASE c.value ->> '$.state.status' WHEN 'streaming' THEN 'pending' ELSE c.value ->> '$.state.status' END,
        'input', c.value -> '$.state.input',
        'output', (SELECT group_concat(item.value ->> '$.text', char(10)) FROM json_each(c.value, '$.state.content') item
                    WHERE item.value ->> '$.type' = 'text'),
        'error', c.value ->> '$.state.error.message',
        'metadata', c.value -> '$.state.metadata',
        'time', json_object('start', COALESCE(c.value ->> '$.time.ran', c.value ->> '$.time.created'), 'end', c.value ->> '$.time.completed')))
    ELSE c.value
  END
FROM oc_lens_v2_rows r, json_each(r.data, '$.content') c WHERE r.type = 'assistant'
UNION ALL
-- A step's snapshot diff is the 1.x \`patch\` part under a new name: a working-tree
-- diff, not scoped to this session (data-model §5), so it renders as a labelled
-- snapshot and never feeds the file-change timeline. Emitted only when files changed.
SELECT r.id || '.1-patch', r.id, r.session_id, r.time_created, r.time_updated,
  json_object('type', 'patch', 'hash', COALESCE(r.data ->> '$.snapshot.end', r.data ->> '$.snapshot.start'), 'files', r.data -> '$.snapshot.files')
FROM oc_lens_v2_rows r
WHERE r.type = 'assistant' AND json_type(r.data, '$.snapshot.files') = 'array' AND json_array_length(r.data, '$.snapshot.files') > 0
  AND COALESCE(r.data ->> '$.snapshot.end', r.data ->> '$.snapshot.start') IS NOT NULL
UNION ALL
SELECT r.id || '.2', r.id, r.session_id, r.time_created, r.time_updated,
  json_patch('{}', json_object('type', 'step-finish', 'reason', r.data ->> '$.finish', 'cost', r.data ->> '$.cost', 'tokens', r.data -> '$.tokens'))
FROM oc_lens_v2_rows r WHERE r.type = 'assistant' AND (r.data -> '$.tokens' IS NOT NULL OR r.data ->> '$.finish' IS NOT NULL)
UNION ALL
SELECT r.id || '.1-000000', r.id, r.session_id, r.time_created, r.time_updated,
  json_object('type', 'text', 'text', COALESCE(r.data ->> '$.text', ''))
FROM oc_lens_v2_rows r WHERE r.type IN ('user', 'synthetic')
UNION ALL
-- v2 records why a compaction ran (auto/manual) but not whether the context
-- overflowed, so overflow is left absent — the decoder reads that as unknown.
SELECT r.id || '.1-000000', r.id, r.session_id, r.time_created, r.time_updated,
  json_patch('{}', json_object('type', 'compaction',
    'auto', CASE r.data ->> '$.reason' WHEN 'auto' THEN json('true') WHEN 'manual' THEN json('false') END))
FROM oc_lens_v2_rows r WHERE r.type = 'compaction'
UNION ALL
SELECT r.id || '-summary.1-000000', r.id || '-summary', r.session_id, r.time_created, r.time_updated,
  json_object('type', 'text', 'text', r.data ->> '$.summary')
FROM oc_lens_v2_rows r WHERE r.type = 'compaction' AND COALESCE(r.data ->> '$.summary', '') <> ''
UNION ALL
SELECT r.id || '-summary.2', r.id || '-summary', r.session_id, r.time_created, r.time_updated,
  json_patch('{}', json_object('type', 'step-finish', 'cost', r.data ->> '$.cost', 'tokens', r.data -> '$.tokens'))
FROM oc_lens_v2_rows r WHERE r.type = 'compaction' AND r.data -> '$.tokens' IS NOT NULL`;

function v2TodoSql(generation: Exclude<DbGeneration, "v1">): string {
  const legacyGuard = generation === "mixed" ? "AND NOT EXISTS (SELECT 1 FROM main.todo lt WHERE lt.session_id = r.session_id)" : "";
  return `
WITH calls AS (
  SELECT r.session_id, r.seq, c.key AS idx, r.time_created, r.time_updated,
    COALESCE(c.value -> '$.state.metadata.todos', c.value -> '$.state.input.todos') AS todos
  FROM oc_lens_v2_rows r, json_each(r.data, '$.content') c
  WHERE r.type = 'assistant' AND c.value ->> '$.type' = 'tool' AND c.value ->> '$.name' = 'todowrite'
    AND c.value ->> '$.state.status' = 'completed' ${legacyGuard}
), latest AS (
  SELECT *, row_number() OVER (PARTITION BY session_id ORDER BY seq DESC, idx DESC) AS rank FROM calls WHERE todos IS NOT NULL
)
SELECT l.session_id, t.value ->> '$.content' AS content, t.value ->> '$.status' AS status,
  t.value ->> '$.priority' AS priority, t.key AS position, l.time_created, l.time_updated
FROM latest l, json_each(l.todos) t
WHERE l.rank = 1 AND json_type(l.todos) = 'array'`;
}

const LEGACY_SESSION_SELECT = `SELECT ${SESSION_COLUMNS.join(", ")} FROM main.session WHERE id NOT IN (SELECT id FROM main.session_v2)`;

/**
 * Lifecycle records, one row each — everything in the projected transcript that
 * is not a user/assistant/compaction message. `kind` is `session_message.type`
 * verbatim, so a type added upstream after this was written still arrives.
 */
const V2_EVENT_SQL = `
SELECT r.id, r.session_id, r.type AS kind, r.seq, r.time_created, r.data
FROM oc_lens_v2_rows r WHERE r.type NOT IN ('user', 'synthetic', 'compaction', 'assistant')`;

/**
 * The v2 projection is materialised into these in-memory TEMP tables, keyed by
 * name to the `*_src` view that computes it. Re-deriving it from JSON on every
 * query cost ~4x a plain legacy scan; materialised, a page that scans `part`
 * several times parses each transcript row once.
 */
const MATERIALISED = [
  { table: "oc_lens_v2_message", columns: "id, session_id, time_created, time_updated, data", indexes: ["session_id", "id"] },
  { table: "oc_lens_v2_part", columns: "id, message_id, session_id, time_created, time_updated, data", indexes: ["session_id", "message_id"] },
  { table: "oc_lens_v2_todo", columns: "session_id, content, status, priority, position, time_created, time_updated", indexes: ["session_id"] },
  { table: "oc_session_event", columns: "id, session_id, kind, seq, time_created, data", indexes: ["session_id"] },
] as const;

/** Statements that build the TEMP objects for `generation`. Empty for v1 — its tables are read directly. */
export function canonicalViewSql(generation: DbGeneration): string[] {
  if (generation === "v1") return [];
  const mixed = generation === "mixed";
  const sources: Record<(typeof MATERIALISED)[number]["table"], string> = {
    oc_lens_v2_message: V2_MESSAGE_SQL,
    oc_lens_v2_part: V2_PART_SQL,
    oc_lens_v2_todo: `SELECT * FROM (${v2TodoSql(generation)})`,
    oc_session_event: V2_EVENT_SQL,
  };
  return [
    `CREATE TEMP VIEW oc_lens_v2_rows AS ${v2RowsSql(generation)}`,
    ...MATERIALISED.flatMap(({ table, columns, indexes }) => [
      `CREATE TEMP VIEW ${table}_src AS ${sources[table]}`,
      `CREATE TEMP TABLE ${table} AS SELECT ${columns} FROM ${table}_src WHERE 0`,
      ...indexes.map((column) => `CREATE INDEX temp.${table}_${column}_idx ON ${table} (${column})`),
    ]),
    `CREATE TEMP VIEW session AS ${V2_SESSION_SELECT}${mixed ? ` UNION ALL ${LEGACY_SESSION_SELECT}` : ""}`,
    `CREATE TEMP VIEW message AS ${mixed ? "SELECT id, session_id, time_created, time_updated, data FROM main.message UNION ALL " : ""}SELECT id, session_id, time_created, time_updated, data FROM oc_lens_v2_message`,
    `CREATE TEMP VIEW part AS ${mixed ? "SELECT id, message_id, session_id, time_created, time_updated, data FROM main.part UNION ALL " : ""}SELECT id, message_id, session_id, time_created, time_updated, data FROM oc_lens_v2_part`,
    `CREATE TEMP VIEW todo AS ${mixed ? "SELECT session_id, content, status, priority, position, time_created, time_updated FROM main.todo UNION ALL " : ""}SELECT session_id, content, status, priority, position, time_created, time_updated FROM oc_lens_v2_todo`,
  ];
}

interface Prepared {
  generation: DbGeneration;
  /** `PRAGMA data_version` when the materialised projection was last built; -1 before the first build. */
  dataVersion: number;
}

const prepared = new WeakMap<DatabaseSync, Prepared>();

function dataVersion(db: DatabaseSync): number {
  return (db.prepare("PRAGMA data_version").get() as { data_version: number }).data_version;
}

/**
 * Rebuilds the materialised projection when opencode has committed since the
 * last build. `PRAGMA data_version` changes exactly when another connection
 * commits to the file, so a quiet database costs one PRAGMA per query and a
 * live one is never served a stale transcript.
 */
function refresh(db: DatabaseSync, state: Prepared): void {
  const version = dataVersion(db);
  if (version === state.dataVersion) return;
  db.exec("BEGIN");
  try {
    for (const { table, columns } of MATERIALISED) {
      db.exec(`DELETE FROM temp.${table}`);
      db.exec(`INSERT INTO temp.${table} (${columns}) SELECT ${columns} FROM ${table}_src`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  state.dataVersion = version;
}

/**
 * Detects the generation, installs the canonical TEMP objects once per
 * connection, and keeps the materialised v2 projection current. Every write
 * here lands in this connection's private in-memory `temp` schema
 * (`temp_store = MEMORY`); the read-only connection rejects anything touching
 * `main`, so opencode.db is never written (D2).
 */
export function ensureCanonicalViews(db: DatabaseSync): DbGeneration {
  let state = prepared.get(db);
  if (!state) {
    const generation = detectGeneration(db);
    if (generation !== "v1" && !tableExists(db, "temp", "oc_lens_v2_rows")) {
      db.exec("PRAGMA temp_store = MEMORY");
      for (const statement of canonicalViewSql(generation)) db.exec(statement);
    }
    state = { generation, dataVersion: -1 };
    prepared.set(db, state);
  }
  if (state.generation !== "v1") refresh(db, state);
  return state.generation;
}

export interface SessionEventRow {
  id: string;
  session_id: string;
  kind: string;
  seq: number;
  time_created: number;
  data: string;
}

/** A session's v2 lifecycle records in transcript order. Always empty on a 1.x database, which has none. */
export function listSessionEvents(db: DatabaseSync, sessionId: string): SessionEventRow[] {
  if (ensureCanonicalViews(db) === "v1") return [];
  return db.prepare("SELECT id, session_id, kind, seq, time_created, data FROM oc_session_event WHERE session_id = ? ORDER BY seq")
    .all(sessionId) as unknown as SessionEventRow[];
}
